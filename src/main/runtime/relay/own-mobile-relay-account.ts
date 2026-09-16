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
  const hasAdmin = securityState.hasAdminAccount ? await securityState.hasAdminAccount() : false
  if (hasAdmin) {
    const adminByEmail = await securityState.getAccount({ email: operator.email })
    if (adminByEmail && adminByEmail.role === 'admin') {
      return adminByEmail
    }
    const adminAccount = await securityState.getAccount({ role: 'admin' })
    if (adminAccount && adminAccount.role === 'admin') {
      return adminAccount
    }
    const anyAccount = await securityState.getAccount()
    if (anyAccount && anyAccount.role === 'admin') {
      return anyAccount
    }
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
