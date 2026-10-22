import type { OrcadManagedRollbackResult } from '../../shared/orcad-managed-runtime'
import type * as runtimeEnvironments from '../../shared/runtime-environments'
import { findIncompleteManagedOrcadMigration } from '../managed-server/lifecycle/orcad-managed-migration-status'
import { latestOrcadMigrationInto } from './orcad-migration-rollback-mark'

/**
 * A rollback restores the snapshot taken when the current version activated. If a migration
 * began after that, the snapshot predates the imported catalog and restoring it would drop it.
 */
export function migrationRollbackRefusal(
  userDataPath: string,
  environment: runtimeEnvironments.KnownRuntimeEnvironment,
  activatedAt: string | null
): OrcadManagedRollbackResult | null {
  if (findIncompleteManagedOrcadMigration(userDataPath, environment.id)) {
    return {
      outcome: 'refused',
      code: 'orcad_rollback_migration_in_progress',
      reason: 'A migration into this server is still running. Finish it before rolling back.'
    }
  }
  const migratedAt = latestOrcadMigrationInto(userDataPath, environment)
  if (migratedAt && (activatedAt === null || Date.parse(activatedAt) < Date.parse(migratedAt))) {
    return {
      outcome: 'refused',
      code: 'orcad_rollback_crosses_migration',
      reason:
        "The previous version's state predates the projects migrated onto this server; " +
        'rolling back would lose them. Deploy forward instead.'
    }
  }
  return null
}
