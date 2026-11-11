import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { AUDIT_ERROR } from '../api/audit-errors.js'
import type { runAudit } from '../runner.js'

type Db = FastifyInstance['db']
type AuditPage = Awaited<ReturnType<typeof runAudit>>[number]
type Id = string
type AuditStatus = 'running' | 'completed' | 'failed' | 'queued'

type AuditRow = {
  id: Id
  url: string
  created_at: string
  deleted_at: string | null
  result: string | null
  status: AuditStatus
  error: string | null
  attempts: number
}

export async function queueAudit(db: Db, url: string) {
  const id = randomUUID()

  await db.run(`INSERT INTO audits (id, url, status) VALUES (?, ?, 'queued')`, id, url)

  return id
}

// One worker per database, so any 'running' row at startup was interrupted.
export async function recoverInterruptedAudits(db: Db, maxAttempts = 3) {
  await db.run(
    `UPDATE audits
     SET status = CASE WHEN attempts >= ? THEN 'failed' ELSE 'queued' END,
         error  = CASE WHEN attempts >= ? THEN ? ELSE error END
     WHERE status = 'running' AND deleted_at IS NULL`,
    maxAttempts,
    maxAttempts,
    AUDIT_ERROR.interrupted
  )
}

export async function getAudit(db: Db, id: Id) {
  const row = await db.get<AuditRow>('SELECT * FROM audits WHERE id = ? AND deleted_at IS NULL', id)

  if (!row) {
    return undefined
  }

  return {
    ...row,
    result: row.result === null ? null : JSON.parse(row.result)
  }
}

export async function deleteAudit(db: Db, id: Id) {
  const result = await db.run(
    `UPDATE audits
     SET deleted_at = CURRENT_TIMESTAMP
     WHERE id = ? AND deleted_at IS NULL`,
    id
  )

  return result.changes === 1
}

export async function claimNextAudit(db: Db) {
  const nextAudit = await db.get<AuditRow>(
    `UPDATE audits
     SET status = 'running', attempts = attempts + 1, error = NULL
     WHERE id = (
       SELECT id
       FROM audits
       WHERE status = 'queued'
         AND deleted_at IS NULL
       ORDER BY created_at ASC, id ASC
       LIMIT 1
     )
     RETURNING *`
  )

  return nextAudit ? { id: nextAudit.id, url: nextAudit.url } : undefined
}

export async function failAudit(db: Db, id: Id, error: string | null) {
  await db.run(
    `UPDATE audits
     SET status = 'failed', error = ?
     WHERE id = ?
       AND status = 'running'
       AND deleted_at IS NULL`,
    error,
    id
  )
}

export async function completeAudit(db: Db, id: Id, page: AuditPage) {
  await db.get(
    `UPDATE audits
     SET status = 'completed', result = ?
     WHERE id = ?
       AND status = 'running'
       AND deleted_at IS NULL
    `,
    JSON.stringify(page),
    id
  )
}
