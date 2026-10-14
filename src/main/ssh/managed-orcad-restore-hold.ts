/**
 * Launch-time tunnel restore and mobile-via-Mac resolve can otherwise auto-update or redeploy a
 * managed server. Set ORCA_HOLD_MANAGED_ORCAD_RESTORE=1 so restore cannot mutate the live orcad.
 */
export const MANAGED_ORCAD_RESTORE_HOLD_ENV = 'ORCA_HOLD_MANAGED_ORCAD_RESTORE'

export function isManagedOrcadRestoreMutationHeld(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env[MANAGED_ORCAD_RESTORE_HOLD_ENV]
  return value === '1' || value === 'true'
}
