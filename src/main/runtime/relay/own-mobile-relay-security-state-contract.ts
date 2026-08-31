import { describe } from 'vitest'
import type { OwnMobileRelaySecurityState } from './own-mobile-relay-security-state'
import { registerAccountAndVerifierTests } from './own-mobile-relay-security-state-account-contract'
import { registerSessionAndGrantTests } from './own-mobile-relay-security-state-session-contract'
import { registerGrantLifecycleTests } from './own-mobile-relay-security-state-grant-contract'
import { registerDeviceAndEpochTests } from './own-mobile-relay-security-state-device-contract'
import { registerRefreshTokenAndKeyExpiryTests } from './own-mobile-relay-security-state-refresh-contract'

export function registerOwnMobileRelaySecurityStateContractTests(
  createAdapter: () => Promise<OwnMobileRelaySecurityState> | OwnMobileRelaySecurityState
): void {
  describe('OwnMobileRelaySecurityState Contract', () => {
    registerAccountAndVerifierTests(createAdapter)
    registerSessionAndGrantTests(createAdapter)
    registerGrantLifecycleTests(createAdapter)
    registerDeviceAndEpochTests(createAdapter)
    registerRefreshTokenAndKeyExpiryTests(createAdapter)
  })
}
