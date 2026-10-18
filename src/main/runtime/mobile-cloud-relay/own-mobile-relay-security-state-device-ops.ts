import type {
  SecurityStateDeviceInstallInput,
  SecurityStateDeviceInstallResult,
  SecurityStateDeviceInstallStatusResult,
  SecurityStateDeviceMatchResult
} from './own-mobile-relay-security-state'
import type { InternalDeviceRecord } from './own-mobile-relay-security-state-types'
import { matchDeviceRecord } from './own-mobile-relay-security-state-device-cleanup'
import { assertOpen, type MemoryStoreContext } from './own-mobile-relay-security-state-memory-ops'
import { RESUME_TOKEN_TTL_MS, GRACE_TOKEN_TTL_MS } from './own-mobile-relay-types'

export function installDeviceCredentialMemory(
  ctx: MemoryStoreContext,
  input: SecurityStateDeviceInstallInput,
  now: number
): SecurityStateDeviceInstallResult {
  assertOpen(ctx)
  if (!/^[A-Za-z0-9_-]{43}$/.test(input.newResumeTokenHash)) {
    return { ok: false, code: 'invalid_token_hash' }
  }
  if (
    input.authorizationMode !== 'relay-basis' &&
    input.authorizationMode !== 'authenticated-direct'
  ) {
    return { ok: false, code: 'invalid_authorization' }
  }
  const key = `${input.relayHostId}:${input.relayDeviceId}`
  const existing = ctx.devicesByKey.get(key)
  if (
    input.expectedCurrentHash !== undefined &&
    existing?.currentResumeTokenHash !== input.expectedCurrentHash
  ) {
    return { ok: false, code: 'hash-mismatch' }
  }
  const currentVersion = existing ? existing.currentVersion + 1 : 1
  const resumeTtl = input.resumeTtlMs ?? RESUME_TOKEN_TTL_MS
  const graceTtl = input.graceTtlMs ?? GRACE_TOKEN_TTL_MS
  const resumeExpiresAt = now + resumeTtl
  const keyExpiryDisabled = existing ? (existing.keyExpiryDisabled ?? true) : true
  const record: InternalDeviceRecord = {
    relayHostId: input.relayHostId,
    relayDeviceId: input.relayDeviceId,
    lastInstallReqId: input.reqId,
    currentResumeTokenHash: input.newResumeTokenHash,
    currentVersion,
    resumeExpiresAt,
    authorizationMode: input.authorizationMode,
    keyExpiryDisabled
  }
  if (existing) {
    record.graceResumeTokenHash = existing.currentResumeTokenHash
    record.graceExpiresAt = now + graceTtl
  }
  ctx.devicesByKey.set(key, record)
  return {
    ok: true,
    installed: {
      v: 1,
      reqId: input.reqId,
      authorizationMode: record.authorizationMode,
      currentVersion: record.currentVersion,
      resumeExpiresAt: record.resumeExpiresAt,
      ...(record.graceExpiresAt !== undefined ? { graceExpiresAt: record.graceExpiresAt } : {})
    }
  }
}

export function getDeviceCredentialInstallStatusMemory(
  ctx: MemoryStoreContext,
  relayHostId: string,
  relayDeviceId: string,
  reqId: string
): SecurityStateDeviceInstallStatusResult {
  assertOpen(ctx)
  const key = `${relayHostId}:${relayDeviceId}`
  const record = ctx.devicesByKey.get(key)
  if (!record || record.revokedAt !== undefined) {
    return { v: 1, reqId, state: 'not-found' }
  }
  return {
    v: 1,
    reqId,
    state: 'committed',
    result: {
      v: 1,
      reqId: record.lastInstallReqId,
      authorizationMode: record.authorizationMode,
      currentVersion: record.currentVersion,
      resumeExpiresAt: record.resumeExpiresAt,
      ...(record.graceExpiresAt !== undefined ? { graceExpiresAt: record.graceExpiresAt } : {})
    }
  }
}

export function matchDeviceCredentialMemory(
  ctx: MemoryStoreContext,
  relayHostId: string,
  tokenHash: string,
  now: number
): SecurityStateDeviceMatchResult | null {
  assertOpen(ctx)
  return matchDeviceRecord(ctx.devicesByKey.values(), relayHostId, tokenHash, now)
}

export function revokeDeviceCredentialMemory(
  ctx: MemoryStoreContext,
  relayHostId: string,
  relayDeviceId: string,
  now: number
): boolean {
  assertOpen(ctx)
  const key = `${relayHostId}:${relayDeviceId}`
  const record = ctx.devicesByKey.get(key)
  if (!record || record.revokedAt !== undefined) {
    return false
  }
  record.revokedAt = now
  return true
}
