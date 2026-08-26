import type { OwnMobileRelayOperatorConfig } from './own-mobile-relay-types'
import {
  derivePasswordRecord,
  CURRENT_PASSWORD_POLICY,
  type PasswordPolicy
} from './own-mobile-relay-password'
import type {
  OwnMobileRelaySecurityState,
  SecurityStateAccountIdentity
} from './own-mobile-relay-security-state'

export async function bootstrapOperatorAccount(
  securityState: OwnMobileRelaySecurityState,
  operator: OwnMobileRelayOperatorConfig,
  policy: PasswordPolicy = CURRENT_PASSWORD_POLICY,
  now = Date.now()
): Promise<SecurityStateAccountIdentity> {
  const existing = await securityState.getAccount()
  if (existing) {
    return existing
  }

  const passwordRecord = await derivePasswordRecord(operator.password, policy)
  return securityState.bootstrapAccount(
    {
      email: operator.email,
      userId: operator.userId,
      profileId: operator.profileId,
      organizationId: operator.organizationId,
      passwordRecord
    },
    now
  )
}
