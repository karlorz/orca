import { describe } from 'vitest'
import { registerOwnMobileRelaySecurityStateContractTests } from './own-mobile-relay-security-state-contract'
import { createOwnMobileRelaySecurityStateMemory } from './own-mobile-relay-security-state-memory'

describe('OwnMobileRelaySecurityState Memory Adapter', () => {
  registerOwnMobileRelaySecurityStateContractTests(() => createOwnMobileRelaySecurityStateMemory())
})
