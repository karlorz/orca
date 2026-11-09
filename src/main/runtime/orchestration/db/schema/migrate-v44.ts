import type { OrchestrationDb } from "../orchestration-db"

const TASK_BINDING_COLUMNS = [
  ["tasks", "message_id", "TEXT"],
  ["tasks", "card_digest", "TEXT"],
  ["tasks", "intent_job", "TEXT"],
  ["tasks", "intent_run", "TEXT"],
  ["tasks", "binding_generation", "INTEGER NOT NULL DEFAULT 1"],
  ["runs", "mailbox_fence", "INTEGER NOT NULL DEFAULT 0"]
] as const

/** Unique-bind identity and mailbox fencing; fresh databases already got both from createTables. */
export function migrateV44(this: OrchestrationDb, current: number): void {
  if (current >= 44) {
    return
  }
  for (const [table, column, type] of TASK_BINDING_COLUMNS) {
    if (!this.hasColumn(table, column)) {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
    }
  }
  this.db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_message_id_unique
      ON tasks(message_id) WHERE message_id IS NOT NULL;
    CREATE TABLE IF NOT EXISTS task_binding_intents (
      intent_id             TEXT PRIMARY KEY,
      message_id            TEXT NOT NULL,
      card_digest           TEXT NOT NULL,
      intent_job            TEXT,
      intent_run            TEXT,
      owner_terminal_handle TEXT,
      generation            INTEGER NOT NULL,
      state                 TEXT NOT NULL
        CHECK(state IN (\x27reserved\x27, \x27committed\x27, \x27conflict\x27)),
      task_id               TEXT,
      error                 TEXT,
      created_at            TEXT,
      updated_at            TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_task_binding_intents_message_id
      ON task_binding_intents(message_id);
  `)
}
