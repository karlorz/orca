import { createHash } from 'node:crypto'
import type {
  InternalAccountRecord,
  InternalDeviceRecord,
  InternalGrantRecord,
  InternalSessionRecord
} from './own-mobile-relay-security-state-types'
import type {
  SecurityStateCleanupResult,
  SecurityStateDeviceCredential,
  SecurityStateDeviceMatchResult
} from './own-mobile-relay-security-state'
import { isGrantValid, isSessionValid } from './own-mobile-relay-security-state-validation'

export function sha256Base64Url(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('base64url')
}

export function matchDeviceRecord(
  devices: Iterable<InternalDeviceRecord>,
  relayHostId: string,
  tokenHash: string,
  now: number
): SecurityStateDeviceMatchResult | null {
  for (const record of devices) {
    if (record.relayHostId !== relayHostId || record.revokedAt !== undefined) {
      continue
    }
    const base: SecurityStateDeviceCredential = {
      relayHostId: record.relayHostId,
      relayDeviceId: record.relayDeviceId,
      lastInstallReqId: record.lastInstallReqId,
      currentVersion: record.currentVersion,
      resumeExpiresAt: record.resumeExpiresAt,
      authorizationMode: record.authorizationMode,
      graceExpiresAt: record.graceExpiresAt
    }
    if (record.currentResumeTokenHash === tokenHash && record.resumeExpiresAt > now) {
      return { device: base, acceptedAs: 'current' }
    }
    if (
      record.graceResumeTokenHash === tokenHash &&
      record.graceExpiresAt !== undefined &&
      record.graceExpiresAt > now
    ) {
      return { device: base, acceptedAs: 'grace' }
    }
  }
  return null
}

export function cleanupExpiredRecords(
  sessions: {
    byId: Map<string, InternalSessionRecord>
    byAccess: Map<string, string>
    byRefresh: Map<string, string>
  },
  grants: {
    byId: Map<string, InternalGrantRecord>
    byToken: Map<string, string>
  },
  devices: Map<string, InternalDeviceRecord>,
  account: InternalAccountRecord | null,
  maxBatch: number,
  now: number
): SecurityStateCleanupResult {
  let expiredSessionsDeleted = 0
  let expiredGrantsDeleted = 0
  let expiredDevicesDeleted = 0

  for (const [sessionId, session] of sessions.byId.entries()) {
    if (expiredSessionsDeleted >= maxBatch) {
      break
    }
    if (!isSessionValid(session, account, now)) {
      sessions.byId.delete(sessionId)
      sessions.byAccess.delete(session.accessTokenHash)
      sessions.byRefresh.delete(session.refreshTokenHash)
      expiredSessionsDeleted += 1
    }
  }

  for (const [grantId, grant] of grants.byId.entries()) {
    if (expiredGrantsDeleted >= maxBatch) {
      break
    }
    const parent = sessions.byId.get(grant.parentSessionId)
    if (!isGrantValid(grant, parent, account, now)) {
      grants.byId.delete(grantId)
      grants.byToken.delete(grant.relayTokenHash)
      expiredGrantsDeleted += 1
    }
  }

  for (const [key, device] of devices.entries()) {
    if (expiredDevicesDeleted >= maxBatch) {
      break
    }
    const isExpired =
      device.revokedAt !== undefined ||
      (device.resumeExpiresAt <= now &&
        (device.graceExpiresAt === undefined || device.graceExpiresAt <= now))
    if (isExpired) {
      devices.delete(key)
      expiredDevicesDeleted += 1
    }
  }

  return { expiredSessionsDeleted, expiredGrantsDeleted, expiredDevicesDeleted }
}
