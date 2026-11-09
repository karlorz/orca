import type { OrchestrationDb } from "../orchestration-db"
import { TASK_BINDING_UNIQUE_INDEXES_SQL } from "./create-graph-tables-sql"
import { assertNoDuplicateTaskBindings } from "./task-binding-indexes"

/** Global M/C/J uniqueness. Conflicting pre-v45 rows fail closed; this migration never remaps. */
export function migrateV45(this: OrchestrationDb, current: number): void {
  if (current >= 45) {
    return
  }
  assertNoDuplicateTaskBindings.call(this)
  this.db.exec(TASK_BINDING_UNIQUE_INDEXES_SQL)
}
