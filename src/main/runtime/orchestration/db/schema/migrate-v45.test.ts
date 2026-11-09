import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { SCHEMA_VERSION } from "../contract-constants"
import { OrchestrationDb } from "../orchestration-db"
import { migrateV45 } from "./migrate-v45"

const CARD = "f".repeat(64)
const OTHER_CARD = "e".repeat(64)

describe("task binding uniqueness migration v45", () => {
  const connections: OrchestrationDb[] = []
  const directories: string[] = []
  afterEach(() => {
    for (const db of connections.splice(0)) {
      db.close()
    }
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true })
    }
  })
  function open(path = ":memory:"): OrchestrationDb {
    const db = new OrchestrationDb(path)
    connections.push(db)
    return db
  }
  function databasePath(): string {
    const directory = mkdtempSync(join(tmpdir(), "orca-binding-v45-"))
    directories.push(directory)
    return join(directory, "orchestration.db")
  }
  function indexNames(db: OrchestrationDb): string[] {
    return (
      db.db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as {
        name: string
      }[]
    ).map((row) => row.name)
  }
  function insertBoundTask(
    db: OrchestrationDb,
    id: string,
    messageId: string,
    cardDigest: string,
    intentJob: string
  ): void {
    db.db
      .prepare(
        `INSERT INTO tasks (id, run_id, spec, status, deps, message_id, card_digest, intent_job)
         VALUES (?, 'run_legacy_local', 'seeded', 'ready', '[]', ?, ?, ?)`
      )
      .run(id, messageId, cardDigest, intentJob)
  }

  it("creates both partial unique indexes on a fresh database", () => {
    const db = open()
    expect(indexNames(db)).toEqual(
      expect.arrayContaining(["idx_tasks_card_digest_unique", "idx_tasks_intent_job_unique"])
    )
  })

  it("upgrades a v44 stamp through the migration registry", () => {
    const path = databasePath()
    const first = open(path)
    first.db.exec(
      "DROP INDEX IF EXISTS idx_tasks_card_digest_unique; DROP INDEX IF EXISTS idx_tasks_intent_job_unique;"
    )
    first.db.pragma("user_version = 44")
    first.close()
    connections.pop()

    const upgraded = open(path)
    expect(upgraded.db.pragma("user_version", { simple: true })).toBe(SCHEMA_VERSION)
    expect(indexNames(upgraded)).toEqual(
      expect.arrayContaining(["idx_tasks_card_digest_unique", "idx_tasks_intent_job_unique"])
    )
  })

  it("fails closed when a v44 database already holds duplicate card identities", () => {
    const db = open()
    db.db.exec(
      "DROP INDEX IF EXISTS idx_tasks_card_digest_unique; DROP INDEX IF EXISTS idx_tasks_intent_job_unique;"
    )
    insertBoundTask(db, "task_dup_card_a", "msg_dup_card_a", CARD, "job_dup_card_a")
    insertBoundTask(db, "task_dup_card_b", "msg_dup_card_b", CARD, "job_dup_card_b")

    expect(() => migrateV45.call(db, 44)).toThrow(/duplicate card_digest=/)
  })

  it("fails closed when a v44 database already holds duplicate intent jobs", () => {
    const db = open()
    db.db.exec(
      "DROP INDEX IF EXISTS idx_tasks_card_digest_unique; DROP INDEX IF EXISTS idx_tasks_intent_job_unique;"
    )
    insertBoundTask(db, "task_dup_job_a", "msg_dup_job_a", CARD, "job_dup")
    insertBoundTask(db, "task_dup_job_b", "msg_dup_job_b", OTHER_CARD, "job_dup")

    expect(() => migrateV45.call(db, 44)).toThrow(/duplicate intent_job=/)
  })

  it("refuses to open a stamped v44 database that already holds duplicates", () => {
    const path = databasePath()
    const seeded = open(path)
    seeded.db.exec(
      "DROP INDEX IF EXISTS idx_tasks_card_digest_unique; DROP INDEX IF EXISTS idx_tasks_intent_job_unique;"
    )
    insertBoundTask(seeded, "task_open_dup_a", "msg_open_dup_a", CARD, "job_open_dup_a")
    insertBoundTask(seeded, "task_open_dup_b", "msg_open_dup_b", CARD, "job_open_dup_b")
    seeded.db.pragma("user_version = 44")
    seeded.close()
    connections.pop()

    expect(() => new OrchestrationDb(path)).toThrow(/duplicate card_digest=/)
  })
})
