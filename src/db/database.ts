import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { AUDIT_ERROR } from '../api/audit-errors.js'
import type { runAudit } from '../runner.js'

type Db = FastifyInstance['db']
type AuditPage = Awaited<ReturnType<typeof runAudit>>[number]
type AuditStatus = 'running' | 'completed' | 'failed' | 'queued'

type AuditRow = {
  id: string
  url: string
  created_at: string
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

// How many times an audit is started before an interruption fails it rather than queueing it again.
const MAX_ATTEMPTS = 3

// One worker per database, so any 'running' row at startup was interrupted.
export async function recoverInterruptedAudits(db: Db) {
  await db.run(
    `UPDATE audits
     SET status = CASE WHEN attempts >= ?1 THEN 'failed' ELSE 'queued' END,
         error  = CASE WHEN attempts >= ?1 THEN ?2 ELSE error END
     WHERE status = 'running'`,
    MAX_ATTEMPTS,
    AUDIT_ERROR.interrupted
  )
}

export async function getAudit(db: Db, id: string) {
  const row = await db.get<AuditRow>('SELECT * FROM audits WHERE id = ?', id)

  if (!row) {
    return undefined
  }

  return {
    ...row,
    result: row.result === null ? null : JSON.parse(row.result)
  }
}

// Removes the audit for good. An audit deleted while it runs is not stopped, and saving its outcome then changes nothing.
export async function deleteAudit(db: Db, id: string) {
  const result = await db.run('DELETE FROM audits WHERE id = ?', id)

  return result.changes === 1
}

// Older versions only hid a deleted audit, by setting deleted_at. Those audits are removed for good, once, with the
// column.
export async function removeHiddenAudits(db: Db) {
  const column = await db.get(`SELECT 1 FROM pragma_table_info('audits') WHERE name = 'deleted_at'`)
  if (!column) return

  await db.run('DELETE FROM audits WHERE deleted_at IS NOT NULL')
  await db.run('ALTER TABLE audits DROP COLUMN deleted_at')
}

// Audits run in the order they were queued. created_at only counts whole seconds, so the order is the rowid, which
// SQLite gives each new row as one more than the largest in the table. Exported so a test can check its query plan.
export const CLAIM_NEXT_AUDIT = `UPDATE audits
     SET status = 'running', attempts = attempts + 1, error = NULL
     WHERE id = (
       SELECT id
       FROM audits
       WHERE status = 'queued'
       ORDER BY rowid
       LIMIT 1
     )
     RETURNING *`

export async function claimNextAudit(db: Db) {
  const nextAudit = await db.get<AuditRow>(CLAIM_NEXT_AUDIT)

  return nextAudit ? { id: nextAudit.id, url: nextAudit.url } : undefined
}

export async function failAudit(db: Db, id: string, error: string) {
  await db.run(
    `UPDATE audits
     SET status = 'failed', error = ?
     WHERE id = ?
       AND status = 'running'`,
    error,
    id
  )
}

export async function completeAudit(db: Db, id: string, page: AuditPage) {
  await db.run(
    `UPDATE audits
     SET status = 'completed', result = ?
     WHERE id = ?
       AND status = 'running'`,
    JSON.stringify(page),
    id
  )
}
