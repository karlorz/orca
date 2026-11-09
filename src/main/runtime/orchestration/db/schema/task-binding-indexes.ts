import type { OrchestrationDb } from "../orchestration-db"

type DuplicateBindingRow = { binding_key: string; value: string; count: number }

const DUPLICATE_TASK_BINDINGS_SQL = `
  SELECT 'card_digest' AS binding_key, card_digest AS value, COUNT(*) AS count
  FROM tasks WHERE card_digest IS NOT NULL GROUP BY card_digest HAVING COUNT(*) > 1
  UNION ALL
  SELECT 'intent_job' AS binding_key, intent_job AS value, COUNT(*) AS count
  FROM tasks WHERE intent_job IS NOT NULL GROUP BY intent_job HAVING COUNT(*) > 1
`

/** A v44 database that already holds a conflicting identity fails closed: no silent remap. */
export function assertNoDuplicateTaskBindings(this: OrchestrationDb): void {
  const duplicates = this.db
    .prepare(DUPLICATE_TASK_BINDINGS_SQL)
    .all() as DuplicateBindingRow[]
  if (duplicates.length === 0) {
    return
  }
  const summary = duplicates
    .map((row) => `${row.binding_key}=${row.value} (${row.count} tasks)`)
    .join(", ")
  throw new Error(
    `Orchestration schema v45 cannot enforce unique task bindings: duplicate ${summary}. Reconcile these Tasks before opening this database.`
  )
}
