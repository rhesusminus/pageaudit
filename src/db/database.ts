import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { AUDIT_ERROR } from '../api/audit-errors.js'
import type { auditOnePage } from '../api/audit-page.js'
import { buildReport } from '../report.js'

export type Db = DatabaseSync
export type AuditResult = Awaited<ReturnType<typeof auditOnePage>>
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

// How long a statement waits for another connection, such as a database browser, to release the database before it
// throws SQLITE_BUSY. The wait blocks the server, so it stays short.
const BUSY_TIMEOUT_MS = 1000

// ':memory:' gives a private database that disappears when it is closed.
export const openDatabase = (filename: string) => new DatabaseSync(filename, { timeout: BUSY_TIMEOUT_MS })

export function queueAudit(db: Db, url: string) {
  const id = randomUUID()

  db.prepare(`INSERT INTO audits (id, url, status) VALUES (?, ?, 'queued')`).run(id, url)

  return id
}

// How many times an audit is started before an interruption fails it rather than queueing it again.
const MAX_ATTEMPTS = 3

// One worker per database, so any 'running' row at startup was interrupted.
export function recoverInterruptedAudits(db: Db) {
  db.prepare(
    `UPDATE audits
     SET status = CASE WHEN attempts >= ?1 THEN 'failed' ELSE 'queued' END,
         error  = CASE WHEN attempts >= ?1 THEN ?2 ELSE error END
     WHERE status = 'running'`
  ).run(MAX_ATTEMPTS, AUDIT_ERROR.interrupted)
}

// SQLite's CURRENT_TIMESTAMP, which created_at holds, is "YYYY-MM-DD HH:MM:SS" in UTC. As an ISO 8601 date-time.
export const isoTime = (sqliteTime: string) => `${sqliteTime.replace(' ', 'T')}Z`

// What a completed audit stores and GET /audits/:id returns: the JSON report of its one page, as the CLI writes it
// (schema/report.schema.json), never the runner's page with its internal fields.
// A result without `origins` is one stored before the site checks ran, see storedResult().
type StoredAudit = { page: AuditResult['page']; site: AuditResult['site']; origins?: AuditResult['origins'] }
const reportOf = ({ page, site, origins }: StoredAudit, now?: Date) =>
  buildReport({ pages: [page], site, origins, now })

// Older versions stored the runner's page itself. It holds everything the report is built from, so it becomes one
// when it is read. The time it was made was not kept, so the report says the time the audit was queued.
function storedResult(result: string, createdAt: string) {
  const stored = JSON.parse(result)
  return 'schemaVersion' in stored ? stored : reportOf({ page: stored, site: [] }, new Date(isoTime(createdAt)))
}

export function getAudit(db: Db, id: string) {
  const row = db.prepare('SELECT * FROM audits WHERE id = ?').get(id) as AuditRow | undefined

  if (!row) {
    return undefined
  }

  return {
    ...row,
    result: row.result === null ? null : storedResult(row.result, row.created_at)
  }
}

// Removes the audit for good. An audit deleted while it runs is not stopped, and saving its outcome then changes nothing.
export function deleteAudit(db: Db, id: string) {
  return db.prepare('DELETE FROM audits WHERE id = ?').run(id).changes === 1
}

// Older versions only hid a deleted audit, by setting deleted_at. Those audits are removed for good, once, with the
// column.
export function removeHiddenAudits(db: Db) {
  const column = db.prepare(`SELECT 1 FROM pragma_table_info('audits') WHERE name = 'deleted_at'`).get()
  if (!column) return

  db.exec('DELETE FROM audits WHERE deleted_at IS NOT NULL')
  db.exec('ALTER TABLE audits DROP COLUMN deleted_at')
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

export function claimNextAudit(db: Db) {
  const nextAudit = db.prepare(CLAIM_NEXT_AUDIT).get() as AuditRow | undefined

  return nextAudit ? { id: nextAudit.id, url: nextAudit.url } : undefined
}

export function failAudit(db: Db, id: string, error: string) {
  db.prepare(
    `UPDATE audits
     SET status = 'failed', error = ?
     WHERE id = ?
       AND status = 'running'`
  ).run(error, id)
}

export function completeAudit(db: Db, id: string, result: AuditResult) {
  db.prepare(
    `UPDATE audits
     SET status = 'completed', result = ?
     WHERE id = ?
       AND status = 'running'`
  ).run(JSON.stringify(reportOf(result)), id)
}
