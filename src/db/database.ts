import type { FastifyInstance } from 'fastify'
import hyperid from 'hyperid'
import type { runAudit } from '../runner.js'

type Db = FastifyInstance['db']
type AuditPage = Awaited<ReturnType<typeof runAudit>>[number]

type AuditResult = {
  finalUrl: string
  status: number
  result: AuditPage
}

type AuditRow = {
  id: string
  url: string
  created_at: string
  deleted_at: string | null
  result: string
}

// URL-safe ids: the default base64 alphabet contains "/" and "+", which break /audits/:id.
const instance = hyperid({ urlSafe: true })

const generateId = () => instance()

export async function saveAudit(db: Db, url: string, auditResult: AuditResult) {
  const id = generateId()

  await db.run('INSERT INTO audits (id, url, result) VALUES (?, ?, ?)', id, url, JSON.stringify(auditResult))

  return id
}

export async function getAudit(db: Db, id: string) {
  const row = await db.get<AuditRow>('SELECT * FROM audits WHERE id = ? AND deleted_at IS NULL', id)

  if (!row) {
    return undefined
  }

  return {
    ...row,
    result: JSON.parse(row.result) as AuditResult
  }
}

export async function deleteAudit(db: Db, id: string) {
  const result = await db.run(
    `UPDATE audits
     SET deleted_at = CURRENT_TIMESTAMP
     WHERE id = ? AND deleted_at IS NULL`,
    id
  )

  return result.changes === 1
}
