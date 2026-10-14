import { afterEach, describe, expect, it } from 'vitest'
import {
  isManagedOrcadRestoreMutationHeld,
  MANAGED_ORCAD_RESTORE_HOLD_ENV
} from './managed-orcad-restore-hold'

afterEach(() => {
  delete process.env[MANAGED_ORCAD_RESTORE_HOLD_ENV]
})

describe('managed orcad restore mutation hold', () => {
  it('is off unless the hold env is 1 or true', () => {
    expect(isManagedOrcadRestoreMutationHeld({})).toBe(false)
    expect(isManagedOrcadRestoreMutationHeld({ [MANAGED_ORCAD_RESTORE_HOLD_ENV]: '' })).toBe(false)
    expect(isManagedOrcadRestoreMutationHeld({ [MANAGED_ORCAD_RESTORE_HOLD_ENV]: '0' })).toBe(false)
    expect(isManagedOrcadRestoreMutationHeld({ [MANAGED_ORCAD_RESTORE_HOLD_ENV]: '1' })).toBe(true)
    expect(isManagedOrcadRestoreMutationHeld({ [MANAGED_ORCAD_RESTORE_HOLD_ENV]: 'true' })).toBe(
      true
    )
  })

  it('reads process.env when the caller omits one', () => {
    delete process.env[MANAGED_ORCAD_RESTORE_HOLD_ENV]
    expect(isManagedOrcadRestoreMutationHeld()).toBe(false)
    process.env[MANAGED_ORCAD_RESTORE_HOLD_ENV] = '1'
    expect(isManagedOrcadRestoreMutationHeld()).toBe(true)
  })
})
