import type { OrchestrationDb } from '../orchestration-db'

export const MESSAGE_ID_UPDATE_BATCH_SIZE = 500
const MESSAGE_MUTATION_SAVEPOINT = 'message_id_mutation'

/** Batches large id sets under one savepoint; the mailbox fence bump rides the same savepoint. */
export function runBatchedMessageMutation(
  db: OrchestrationDb,
  ids: string[],
  sqlForPlaceholders: (placeholders: string) => string,
  leadingBindings: string[] = [],
  afterMutation?: () => void
): void {
  if (ids.length === 0) {
    return
  }
  db.db.exec(`SAVEPOINT ${MESSAGE_MUTATION_SAVEPOINT}`)
  try {
    for (let offset = 0; offset < ids.length; offset += MESSAGE_ID_UPDATE_BATCH_SIZE) {
      const batch = ids.slice(offset, offset + MESSAGE_ID_UPDATE_BATCH_SIZE)
      const placeholders = batch.map(() => '?').join(',')
      db.db.prepare(sqlForPlaceholders(placeholders)).run(...leadingBindings, ...batch)
    }
    afterMutation?.()
    db.db.exec(`RELEASE ${MESSAGE_MUTATION_SAVEPOINT}`)
  } catch (error) {
    db.db.exec(`ROLLBACK TO ${MESSAGE_MUTATION_SAVEPOINT}`)
    db.db.exec(`RELEASE ${MESSAGE_MUTATION_SAVEPOINT}`)
    throw error
  }
}
