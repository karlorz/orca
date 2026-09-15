import { describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { RELAY_PROTOCOL_LIMITS } from '@orca-cloud/relay-contract'
import { generateKeyPair, SignJWT } from 'jose'
import {
  hashCredential,
  RelayCredentialStore,
  type CredentialReservation,
  type RelayIdentity
} from './credential-store.js'
import type { RelayConfig } from './config.js'
import { createRelayTokenVerifier } from './relay-token-verifier.js'
import { openInMemoryRelayDatabase, type RelayDatabase } from './database.js'

const identity: RelayIdentity = { userId: 'user-1', relayHostId: 'abcdefghijklmnop' }
const relayDeviceId = 'device-1'

async function inviteBasis(
  store: RelayCredentialStore,
  generation = 1
): Promise<{ reservation: CredentialReservation; basisConnId: string }> {
  const invite = await store.createInvite(identity, relayDeviceId)
  const reservation = await store.reserveCredential(identity.relayHostId, invite.inviteToken)
  if (!reservation) throw new Error('invite did not reserve')
  const basisConnId = `basis-${generation}`
  await store.recordConnectionBasis({
    ...reservation,
    basisConnId,
    owningControlGeneration: generation,
    deadline: reservation.leaseExpiresAt
  })
  return { reservation, basisConnId }
}

describe('relay credential store', () => {
  it('issues invites with a skew margin under the client-side TTL ceiling', async () => {
    const database = await openInMemoryRelayDatabase()
    const store = new RelayCredentialStore(database, () => 1_000_000)
    const invite = await store.createInvite(identity, relayDeviceId)
    // Zero-tolerance released desktops reject expiry past local now + 10min;
    // issuing 30s under the ceiling absorbs that much desktop clock lag.
    expect(invite.expiresAt).toBe(1_000_000 + 10 * 60 * 1_000 - 30 * 1_000)
  })

  it('persists one invite reservation with bounded attempts and cooldown', async () => {
    let now = 100
    const database = await openInMemoryRelayDatabase()
    const store = new RelayCredentialStore(database, () => now)
    const invite = await store.createInvite(identity, relayDeviceId)
    const first = await store.reserveCredential(identity.relayHostId, invite.inviteToken, 'first')
    expect(first).toMatchObject({ credentialKind: 'invite', reservationId: 'first' })
    expect(await store.reserveCredential(identity.relayHostId, invite.inviteToken, 'second')).toBeNull()
    now = first!.leaseExpiresAt
    expect(await store.reserveCredential(identity.relayHostId, invite.inviteToken, 'second')).toBeNull()
    await database.query(`UPDATE relay_invites SET cooldown_until = ? WHERE token_hash = ?`, [
      now,
      hashCredential(invite.inviteToken)
    ])
    expect(await store.reserveCredential(identity.relayHostId, invite.inviteToken, 'second')).toMatchObject({
      reservationId: 'second'
    })
    await database.close()
  })

  it('validates director moves without reservation and enforces account-global mint rate', async () => {
    const database = await openInMemoryRelayDatabase()
    const store = new RelayCredentialStore(database, () => 100)
    const invite = await store.createInvite(identity, relayDeviceId)
    expect(await store.validateInviteForMove(identity.relayHostId, invite.inviteToken)).toBe(true)
    const rows = await database.query(`SELECT state, attempt_count FROM relay_invites WHERE token_hash = ?`, [
      hashCredential(invite.inviteToken)
    ])
    expect(rows[0]).toMatchObject({ state: 'available', attempt_count: 0 })
    for (let index = 1; index < 30; index++) {
      await store.createInvite(identity, `device-${index + 1}`)
    }
    await expect(store.createInvite(identity, 'device-over-limit')).rejects.toMatchObject({
      code: 'rate_limit_exceeded'
    })
    expect(await database.query(`SELECT * FROM relay_audit_events`)).toHaveLength(30)
    await database.close()
  })

  it('serializes relay-basis and authenticated-direct under one global result', async () => {
    const database = await openInMemoryRelayDatabase()
    const store = new RelayCredentialStore(database, () => 100)
    const { basisConnId } = await inviteBasis(store)
    await store.recordDirectAuthorization({
      ...identity,
      relayDeviceId,
      directAuthId: 'direct-1',
      owningControlGeneration: 1,
      deadline: 1_000
    })
    const base = {
      ...identity,
      relayDeviceId,
      reqId: 'req-1',
      newResumeTokenHash: hashCredential('pending-resume'),
      owningControlGeneration: 1
    }
    const [relay, direct] = await Promise.all([
      store.installCredential({
        ...base,
        authorization: { mode: 'relay-basis' as const, basisConnId }
      }),
      store.installCredential({
        ...base,
        authorization: { mode: 'authenticated-direct' as const, directAuthId: 'direct-1' }
      })
    ])
    expect(relay).toEqual(direct)
    expect(relay.currentVersion).toBe(1)
    expect(await store.installStatus(base)).toEqual(relay)
    const devices = await database.query(`SELECT * FROM relay_devices`)
    expect(devices).toHaveLength(1)
    await database.close()
  })

  it('rolls back token and invite effects when result persistence fails', async () => {
    const database = await openInMemoryRelayDatabase()
    const normalStore = new RelayCredentialStore(database, () => 100)
    const { basisConnId, reservation } = await inviteBasis(normalStore)
    const fault: RelayDatabase = {
      query: (sql, params) => database.query(sql, params),
      queryLocked: (sql, params) => database.queryLocked(sql, params),
      close: () => database.close(),
      transaction: async (operation) =>
        await database.transaction(async (transaction) =>
          await operation({
            query: async (sql, params) => {
              if (sql.includes('INSERT INTO relay_install_results')) throw new Error('injected SQL failure')
              return await transaction.query(sql, params)
            },
            queryLocked: (sql, params) => transaction.queryLocked(sql, params),
            transaction: (nested) => transaction.transaction(nested),
            close: () => transaction.close()
          })
        )
    }
    const faultStore = new RelayCredentialStore(fault, () => 100)
    const input = {
      ...identity,
      relayDeviceId,
      reqId: 'req-fault',
      newResumeTokenHash: hashCredential('pending-resume'),
      owningControlGeneration: 1,
      authorization: { mode: 'relay-basis' as const, basisConnId }
    }
    await expect(faultStore.installCredential(input)).rejects.toThrow('injected SQL failure')
    expect(await normalStore.installStatus(input)).toBeNull()
    expect(await database.query(`SELECT * FROM relay_devices`)).toEqual([])
    const invites = await database.query(`SELECT state FROM relay_invites WHERE token_hash = ?`, [
      reservation.tokenHash
    ])
    expect(invites[0]?.state).toBe('reserved')
    await database.close()
  })

  it('renews only a tuple-bound current credential and replays its committed result', async () => {
    let now = 100
    const database = await openInMemoryRelayDatabase()
    const store = new RelayCredentialStore(database, () => now)
    const { basisConnId } = await inviteBasis(store)
    const resumeToken = 'resume-token-1'
    await store.installCredential({
      ...identity,
      relayDeviceId,
      reqId: 'install-1',
      newResumeTokenHash: hashCredential(resumeToken),
      owningControlGeneration: 1,
      authorization: { mode: 'relay-basis', basisConnId }
    })
    const reservation = await store.reserveCredential(identity.relayHostId, resumeToken)
    if (!reservation) throw new Error('resume did not reserve')
    expect(await store.resolveResume(identity.relayHostId, resumeToken)).toEqual({
      userId: identity.userId,
      relayDeviceId
    })
    await store.recordConnectionBasis({
      ...reservation,
      basisConnId: 'resume-basis',
      owningControlGeneration: 1,
      deadline: 1_000
    })
    now = 200
    const confirmed = await store.confirmResume({
      ...identity,
      reqId: 'confirm-1',
      basisConnId: 'resume-basis',
      owningControlGeneration: 1
    })
    expect(confirmed).toMatchObject({ renewed: true, acceptedAs: 'current' })
    await store.deactivateBasis('resume-basis')
    expect(
      await store.confirmResume({
        ...identity,
        reqId: 'confirm-1',
        basisConnId: 'resume-basis',
        owningControlGeneration: 1
      })
    ).toEqual(confirmed)
    await expect(
      store.confirmResume({
        ...identity,
        reqId: 'confirm-1',
        basisConnId: 'other-basis',
        owningControlGeneration: 1
      })
    ).rejects.toMatchObject({ code: 'confirmation_tuple_mismatch' })
    await database.close()
  })

  it('leaves a now-grace version unchanged and rejects late, expired, and revoked tuples', async () => {
    let now = 100
    const database = await openInMemoryRelayDatabase()
    const store = new RelayCredentialStore(database, () => now)
    const { basisConnId } = await inviteBasis(store)
    const firstToken = 'resume-token-1'
    const first = await store.installCredential({
      ...identity,
      relayDeviceId,
      reqId: 'install-1',
      newResumeTokenHash: hashCredential(firstToken),
      owningControlGeneration: 1,
      authorization: { mode: 'relay-basis', basisConnId }
    })
    const firstReservation = await store.reserveCredential(identity.relayHostId, firstToken)
    if (!firstReservation) throw new Error('first resume did not reserve')
    await store.recordConnectionBasis({
      ...firstReservation,
      basisConnId: 'grace-basis',
      owningControlGeneration: 1,
      deadline: 100_000_000
    })
    await store.recordDirectAuthorization({
      ...identity,
      relayDeviceId,
      directAuthId: 'rotate-direct',
      owningControlGeneration: 1,
      deadline: 1_000
    })
    now = 200
    await store.installCredential({
      ...identity,
      relayDeviceId,
      reqId: 'install-2',
      newResumeTokenHash: hashCredential('resume-token-2'),
      expectedCurrentHash: hashCredential(firstToken),
      owningControlGeneration: 1,
      authorization: { mode: 'authenticated-direct', directAuthId: 'rotate-direct' }
    })
    const grace = await store.confirmResume({
      ...identity,
      reqId: 'confirm-grace',
      basisConnId: 'grace-basis',
      owningControlGeneration: 1
    })
    expect(grace).toMatchObject({ acceptedAs: 'current', renewed: false, currentVersion: 2 })
    expect(grace.resumeExpiresAt).toBeGreaterThan(first.resumeExpiresAt)

    now += 24 * 60 * 60 * 1000 + 1
    await expect(
      store.confirmResume({
        ...identity,
        reqId: 'confirm-expired-grace',
        basisConnId: 'grace-basis',
        owningControlGeneration: 1
      })
    ).rejects.toMatchObject({ code: 'reject-expired' })

    const currentReservation = await store.reserveCredential(identity.relayHostId, 'resume-token-2')
    if (!currentReservation) throw new Error('current resume did not reserve')
    await store.recordConnectionBasis({
      ...currentReservation,
      basisConnId: 'revoked-basis',
      owningControlGeneration: 1,
      deadline: now + 1_000
    })
    await store.revoke(identity, relayDeviceId)
    await expect(
      store.confirmResume({
        ...identity,
        reqId: 'confirm-revoked',
        basisConnId: 'revoked-basis',
        owningControlGeneration: 1
      })
    ).rejects.toMatchObject({ code: 'reject-revoked' })

    await store.recordConnectionBasis({
      ...currentReservation,
      basisConnId: 'late-basis',
      owningControlGeneration: 1,
      deadline: now - 1
    })
    await expect(
      store.confirmResume({
        ...identity,
        reqId: 'confirm-late',
        basisConnId: 'late-basis',
        owningControlGeneration: 1
      })
    ).rejects.toMatchObject({ code: 'confirmation_not_active' })
    await database.close()
  })
})

describe('key expiry disabled (fork trusted-machine admission)', () => {
  async function installDirect(
    store: RelayCredentialStore,
    input: { relayDeviceId: string; reqId: string; resumeToken: string }
  ) {
    await store.recordDirectAuthorization({
      ...identity,
      relayDeviceId: input.relayDeviceId,
      directAuthId: `direct-${input.reqId}`,
      owningControlGeneration: 1,
      deadline: 100_000_000
    })
    return await store.installCredential({
      ...identity,
      relayDeviceId: input.relayDeviceId,
      reqId: input.reqId,
      newResumeTokenHash: hashCredential(input.resumeToken),
      owningControlGeneration: 1,
      authorization: { mode: 'authenticated-direct', directAuthId: `direct-${input.reqId}` }
    })
  }

  async function resumeBasis(
    store: RelayCredentialStore,
    token: string,
    basisConnId: string,
    deadline = 100_000_000
  ): Promise<CredentialReservation> {
    const reservation = await store.reserveCredential(identity.relayHostId, token)
    if (!reservation) throw new Error('resume did not reserve')
    await store.recordConnectionBasis({
      ...reservation,
      basisConnId,
      owningControlGeneration: 1,
      deadline
    })
    return reservation
  }

  it('bypasses current resume wall-clock expiry across reserve, resolve, and confirm', async () => {
    let now = 100
    const database = await openInMemoryRelayDatabase()
    const store = new RelayCredentialStore(database, () => now, { keyExpiryDisabled: true })
    const installed = await installDirect(store, {
      relayDeviceId,
      reqId: 'ked-install',
      resumeToken: 'ked-resume-token'
    })
    now = installed.resumeExpiresAt + 1

    const reservation = await store.reserveCredential(identity.relayHostId, 'ked-resume-token')
    expect(reservation).toMatchObject({
      credentialKind: 'resume',
      acceptedAs: 'current',
      acceptedCredentialVersion: 1
    })
    await expect(store.resolveResume(identity.relayHostId, 'ked-resume-token')).resolves.toEqual({
      userId: identity.userId,
      relayDeviceId
    })

    await store.recordConnectionBasis({
      ...reservation!,
      basisConnId: 'ked-basis',
      owningControlGeneration: 1,
      deadline: now + 10_000
    })
    const confirmed = await store.confirmResume({
      ...identity,
      reqId: 'ked-confirm',
      basisConnId: 'ked-basis',
      owningControlGeneration: 1
    })
    expect(confirmed).toMatchObject({
      renewed: true,
      acceptedAs: 'current',
      resumeExpiresAt: now + RELAY_PROTOCOL_LIMITS.resumeTtlMs
    })
    await database.close()
  })

  it('keeps upstream expiry enforcement when the env is off', async () => {
    let now = 100
    const database = await openInMemoryRelayDatabase()
    const store = new RelayCredentialStore(database, () => now)
    const installed = await installDirect(store, {
      relayDeviceId,
      reqId: 'off-install',
      resumeToken: 'off-resume-token'
    })
    await resumeBasis(store, 'off-resume-token', 'off-basis', installed.resumeExpiresAt + 100_000)

    now = installed.resumeExpiresAt + 1
    await expect(store.reserveCredential(identity.relayHostId, 'off-resume-token')).resolves.toBeNull()
    await expect(store.resolveResume(identity.relayHostId, 'off-resume-token')).resolves.toBeNull()
    await expect(
      store.confirmResume({
        ...identity,
        reqId: 'off-confirm',
        basisConnId: 'off-basis',
        owningControlGeneration: 1
      })
    ).rejects.toMatchObject({ code: 'reject-expired' })
    await database.close()
  })

  it('still enforces invite expiry and sweeps it in cleanup', async () => {
    let now = 100
    const database = await openInMemoryRelayDatabase()
    const store = new RelayCredentialStore(database, () => now, { keyExpiryDisabled: true })
    const invite = await store.createInvite(identity, relayDeviceId)
    now = invite.expiresAt + 1
    await expect(
      store.reserveCredential(identity.relayHostId, invite.inviteToken)
    ).resolves.toBeNull()
    await store.cleanup()
    const invites = await database.query(
      `SELECT state FROM relay_invites WHERE token_hash = ?`,
      [hashCredential(invite.inviteToken)]
    )
    expect(invites[0]?.state).toBe('expired')
    await database.close()
  })

  it('still enforces grace expiry on reserve and confirm', async () => {
    let now = 100
    const database = await openInMemoryRelayDatabase()
    const store = new RelayCredentialStore(database, () => now, { keyExpiryDisabled: true })
    await installDirect(store, {
      relayDeviceId,
      reqId: 'grace-install-1',
      resumeToken: 'grace-resume-token-1'
    })
    await resumeBasis(store, 'grace-resume-token-1', 'grace-basis')
    now = 200
    await installDirect(store, {
      relayDeviceId,
      reqId: 'grace-install-2',
      resumeToken: 'grace-resume-token-2'
    })

    now = 200 + 24 * 60 * 60 * 1000 + 1
    await expect(
      store.reserveCredential(identity.relayHostId, 'grace-resume-token-1')
    ).resolves.toBeNull()
    await expect(
      store.confirmResume({
        ...identity,
        reqId: 'grace-confirm',
        basisConnId: 'grace-basis',
        owningControlGeneration: 1
      })
    ).rejects.toMatchObject({ code: 'reject-expired' })
    await database.close()
  })

  it('still rejects revoked and retired credentials', async () => {
    let now = 100
    const database = await openInMemoryRelayDatabase()
    const store = new RelayCredentialStore(database, () => now, { keyExpiryDisabled: true })
    await installDirect(store, {
      relayDeviceId,
      reqId: 'rev-install',
      resumeToken: 'rev-resume-token'
    })
    await resumeBasis(store, 'rev-resume-token', 'rev-basis')
    await store.revoke(identity, relayDeviceId)
    await expect(
      store.reserveCredential(identity.relayHostId, 'rev-resume-token')
    ).resolves.toBeNull()
    await expect(
      store.confirmResume({
        ...identity,
        reqId: 'rev-confirm',
        basisConnId: 'rev-basis',
        owningControlGeneration: 1
      })
    ).rejects.toMatchObject({ code: 'reject-revoked' })

    const retiredDevice = 'device-retired'
    now = 1_000
    await installDirect(store, {
      relayDeviceId: retiredDevice,
      reqId: 'ret-install-1',
      resumeToken: 'ret-resume-token-1'
    })
    await resumeBasis(store, 'ret-resume-token-1', 'ret-basis')
    now = 2_000
    await installDirect(store, {
      relayDeviceId: retiredDevice,
      reqId: 'ret-install-2',
      resumeToken: 'ret-resume-token-2'
    })
    now = 3_000
    await installDirect(store, {
      relayDeviceId: retiredDevice,
      reqId: 'ret-install-3',
      resumeToken: 'ret-resume-token-3'
    })
    now = 4_000
    await expect(
      store.reserveCredential(identity.relayHostId, 'ret-resume-token-1')
    ).resolves.toBeNull()
    await expect(
      store.confirmResume({
        ...identity,
        reqId: 'ret-confirm',
        basisConnId: 'ret-basis',
        owningControlGeneration: 1
      })
    ).rejects.toMatchObject({ code: 'reject-retired' })
    await database.close()
  })

  it('cleanup never sweeps a current device the env keeps admissible', async () => {
    let now = 100
    const database = await openInMemoryRelayDatabase()
    const store = new RelayCredentialStore(database, () => now, { keyExpiryDisabled: true })
    const installed = await installDirect(store, {
      relayDeviceId,
      reqId: 'cleanup-install',
      resumeToken: 'cleanup-resume-token'
    })
    const invite = await store.createInvite(identity, 'cleanup-invite-device')

    now = installed.resumeExpiresAt + 1
    await store.cleanup()

    const devices = await database.query(`SELECT * FROM relay_devices`)
    expect(devices).toHaveLength(1)
    const invites = await database.query(
      `SELECT state FROM relay_invites WHERE token_hash = ?`,
      [hashCredential(invite.inviteToken)]
    )
    expect(invites[0]?.state).toBe('expired')
    await expect(
      store.reserveCredential(identity.relayHostId, 'cleanup-resume-token')
    ).resolves.toMatchObject({ acceptedAs: 'current' })
    await expect(
      store.resolveResume(identity.relayHostId, 'cleanup-resume-token')
    ).resolves.toEqual({ userId: identity.userId, relayDeviceId })
    await database.close()
  })
})

describe('relay token verifier expiry enforcement', () => {
  function verifierConfig(jwksUrl: string): RelayConfig {
    return {
      port: 0,
      publicUrl: 'https://relay.example.test',
      cellUrl: 'https://relay.example.test',
      authIssuer: 'https://auth.example.test',
      authAudience: 'orca-relay',
      jwksUrl,
      assignmentSigningKey: new TextEncoder().encode('assignment-key-with-at-least-32-bytes'),
      role: 'combined',
      cellId: 'combined',
      cells: [],
      adminAudience: 'https://admin.example.test',
      deployServiceAccount: 'deploy@example.test',
      runtimeServiceAccount: 'deploy@example.test',
      adminJwksUrl: 'https://admin.example.test/jwks',
      databasePoolMax: 10,
      publicAssignmentsEnabled: true,
      publicAssignmentConcurrency: 2,
      publicAssignmentQueueMax: 128,
      publicAssignmentWaitMs: 4_000,
      publicResolveConcurrency: 1,
      publicResolveWaitMs: 5_000,
      publicAssignmentRetryAfterSeconds: 5,
      dataDir: './data/relay'
    }
  }

  it('never bypasses JWT exp: an expired token fails verification against a live JWKS', async () => {
    const keys = await generateKeyPair('ES256', { extractable: true })
    const { exportJWK } = await import('jose')
    const publicJwk = await exportJWK(keys.publicKey)
    const jwksServer: Server = createServer((_request, response) => {
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ keys: [{ ...publicJwk, kid: 'ked-key', alg: 'ES256' }] }))
    })
    await new Promise<void>((resolveListen) => jwksServer.listen(0, '127.0.0.1', resolveListen))
    const address = jwksServer.address() as AddressInfo
    try {
      const verify = createRelayTokenVerifier(
        verifierConfig(`http://127.0.0.1:${address.port}/jwks`)
      )
      const claims = {
        prof: 'profile-1',
        org: 'org-1',
        purpose: 'host-control',
        relayHostId: 'abcdefghijklmnop'
      }
      const fresh = await new SignJWT(claims)
        .setProtectedHeader({ alg: 'ES256', kid: 'ked-key' })
        .setIssuer('https://auth.example.test')
        .setAudience('orca-relay')
        .setSubject('user-1')
        .setIssuedAt()
        .setExpirationTime(Math.floor(Date.now() / 1000) + 300)
        .sign(keys.privateKey)
      await expect(verify(fresh)).resolves.toMatchObject({ sub: 'user-1' })

      const expired = await new SignJWT(claims)
        .setProtectedHeader({ alg: 'ES256', kid: 'ked-key' })
        .setIssuer('https://auth.example.test')
        .setAudience('orca-relay')
        .setSubject('user-1')
        .setIssuedAt(Math.floor(Date.now() / 1000) - 600)
        .setExpirationTime(Math.floor(Date.now() / 1000) - 300)
        .sign(keys.privateKey)
      await expect(verify(expired)).resolves.toBeNull()
    } finally {
      await new Promise<void>((resolveClose) => jwksServer.close(() => resolveClose()))
    }
  })
})
