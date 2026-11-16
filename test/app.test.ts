import dns from 'node:dns/promises'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { TestContext } from 'node:test'
import { test } from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'
import type { FastifyInstance } from 'fastify'
import { build } from '../src/api/app.ts'
import { CLAIM_NEXT_AUDIT } from '../src/db/database.ts'
import { FIXTURE_HOST, mockFixtureFetch } from './helpers/fixture-fetch.js'

type Row = { status: string; attempts: number; error: string | null }

// A database file that outlives one app, so a test can stop the server and start it again.
const databaseFile = async () => join(await mkdtemp(join(tmpdir(), 'pageaudit-api-')), 'database.db')

// Leaves the audit as a crash would: claimed by a worker that never finished it.
const interruptedAudit = async (dbFilename: string, attempts: number) => {
  const app = build({}, { dbFilename })
  await app.ready()
  await app.db.run(
    `INSERT INTO audits (id, url, status, attempts) VALUES ('interrupted', ?, 'running', ?)`,
    `${FIXTURE_HOST}/good.html`,
    attempts
  )
  await app.close()
}

const restart = async (t: TestContext, dbFilename: string) => {
  const app = build({}, { dbFilename })
  // Close the database before removing its directory. after() hooks run in the order they were added.
  t.after(async () => {
    await app.close()
    await rm(dirname(dbFilename), { recursive: true, force: true })
  })
  await app.ready()

  return app
}

const waitForRow = async (app: FastifyInstance, done: (row: Row) => boolean) => {
  for (;;) {
    const row = await app.db.get<Row>(`SELECT status, attempts, error FROM audits WHERE id = 'interrupted'`)
    if (row && done(row)) return row
    await sleep(5)
  }
}

test('app: a restart runs an interrupted audit again and counts the attempt', async (t: TestContext) => {
  t.mock.method(dns, 'lookup', async () => [{ address: '93.184.215.14', family: 4 }])
  mockFixtureFetch(t)
  const dbFilename = await databaseFile()
  await interruptedAudit(dbFilename, 1)

  const app = await restart(t, dbFilename)
  const row = await waitForRow(app, ({ status }) => status === 'completed')

  t.assert.deepStrictEqual(row, { status: 'completed', attempts: 2, error: null })
})

// The table and queue index as the first version of the server made them, for the tests of a database it left behind.
const olderDatabase = (dbFilename: string) => {
  const db = new DatabaseSync(dbFilename)
  db.exec(`
    CREATE TABLE audits (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      deleted_at TEXT,
      status TEXT NOT NULL,
      error TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      result TEXT
    );
    CREATE INDEX audits_queue ON audits (created_at, id) WHERE status = 'queued' AND deleted_at IS NULL;
  `)
  return db
}

test('app: an older database gets the index that claims queued audits in the order they were queued', async (t: TestContext) => {
  const dbFilename = await databaseFile()
  olderDatabase(dbFilename).close()

  const app = await restart(t, dbFilename)
  const indexes = await app.db.all<{ name: string }[]>(
    `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'audits' AND sql IS NOT NULL`
  )
  const plan = await app.db.all<{ detail: string }[]>(`EXPLAIN QUERY PLAN ${CLAIM_NEXT_AUDIT}`)

  t.assert.deepStrictEqual(
    indexes.map(({ name }) => name),
    ['audits_queued']
  )
  // The index is read in order, so finding the first queued audit needs no sort.
  const steps = plan.map(({ detail }) => detail)
  t.assert.ok(steps.includes('SEARCH audits USING INDEX audits_queued (status=?)'), steps.join(' | '))
  t.assert.ok(!steps.some((step) => step.includes('TEMP B-TREE')), steps.join(' | '))
})

test('app: a restart fails an audit that was interrupted on every attempt', async (t: TestContext) => {
  const dbFilename = await databaseFile()
  await interruptedAudit(dbFilename, 3)

  const app = await restart(t, dbFilename)
  const row = await waitForRow(app, () => true)

  t.assert.deepStrictEqual(row, { status: 'failed', attempts: 3, error: 'Audit was interrupted' })
})
