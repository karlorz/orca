import type { OwnMobileRelayDeviceCredentialRecord } from './own-mobile-relay-types'

export function matchOwnMobileRelayDeviceCredential(
  deviceCredentials: Map<string, OwnMobileRelayDeviceCredentialRecord>,
  relayHostId: string,
  tokenHash: string,
  now = Date.now()
): { device: OwnMobileRelayDeviceCredentialRecord; acceptedAs: 'current' | 'grace' } | null {
  for (const record of deviceCredentials.values()) {
    if (record.relayHostId !== relayHostId) {
      continue
    }
    if (record.currentResumeTokenHash === tokenHash && record.resumeExpiresAt > now) {
      return { device: record, acceptedAs: 'current' }
    }
    if (
      record.graceResumeTokenHash === tokenHash &&
      record.graceExpiresAt !== undefined &&
      record.graceExpiresAt > now
    ) {
      return { device: record, acceptedAs: 'grace' }
    }
  }
  return null
}
