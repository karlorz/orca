import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { decodeJwt } from 'jose'
import nacl from 'tweetnacl'
import { describe, expect, it } from 'vitest'
import { createRelayTokenVerifier } from '../../../../cloud/apps/relay/src/relay-token-verifier'
import type { RelayConfig } from '../../../../cloud/apps/relay/src/config'
import { deriveRelayHostId } from './relay-http-client'
import { listenOwnMobileRelay } from './own-mobile-relay-http'
import {
  createRelayTokenSigningKey,
  type RelayTokenSigningKey
} from './own-mobile-relay-jwt-issuer'
import { loginAndObtainSessionToken } from './own-mobile-relay-test-auth'
import { derivePasswordRecord, TEST_FAST_PASSWORD_POLICY } from './own-mobile-relay-password'
import { createOwnMobileRelaySecurityStateSqlite } from './own-mobile-relay-security-state-sqlite'
import { createOwnMobileRelaySecurityStateMemory } from './own-mobile-relay-security-state-memory'
import type { OwnMobileRelaySecurityState } from './own-mobile-relay-security-state'

const AUTH_ORIGIN = 'http://127.0.0.1'

function relayVerifierConfig(input: { jwksUrl: string; authIssuer: string }): RelayConfig {
  return {
    port: 0,
    publicUrl: 'https://relay.example.test',
    cellUrl: 'https://relay.example.test',
    authIssuer: input.authIssuer,
    authAudience: 'orca-relay',
    jwksUrl: input.jwksUrl,
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

async function requestRelayToken(
  serverOrigin: string,
  accessToken: string,
  relayHostId: string,
  hostPublicKey: Uint8Array
): Promise<{ relayToken: string; expiresAt: number }> {
  const response = await fetch(`${serverOrigin}/v1/desktop/auth/relay-token`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      relayHostId,
      hostPublicKeyB64: Buffer.from(hostPublicKey).toString('base64')
    })
  })
  expect(response.status).toBe(200)
  return (await response.json()) as { relayToken: string; expiresAt: number }
}

describe('OwnMobileRelay JWT & Grant Isolation for Multiple Users', () => {
  const userAlice = {
    email: 'alice@example.com',
    password: 'alice-password-secret-123',
    userId: 'usr_alice_111111',
    profileId: 'prf_alice_111111',
    organizationId: 'org_alice_111111'
  }

  const userBob = {
    email: 'bob@example.com',
    password: 'bob-password-secret-222',
    userId: 'usr_bob_222222',
    profileId: 'prf_bob_222222',
    organizationId: 'org_bob_222222'
  }

  const backends: {
    name: 'sqlite' | 'memory'
    createState: () => { state: OwnMobileRelaySecurityState; cleanup: () => Promise<void> }
  }[] = [
    {
      name: 'sqlite',
      createState: () => {
        const tempDir = mkdtempSync(join(tmpdir(), 'orca-jwt-grant-sqlite-'))
        const dbPath = join(tempDir, 'security.db')
        const state = createOwnMobileRelaySecurityStateSqlite({ dbPath, testMode: true })
        return {
          state,
          cleanup: async () => {
            await state.close()
            rmSync(tempDir, { recursive: true, force: true })
          }
        }
      }
    },
    {
      name: 'memory',
      createState: () => {
        const state = createOwnMobileRelaySecurityStateMemory()
        return {
          state,
          cleanup: async () => {
            await state.close()
          }
        }
      }
    }
  ]

  backends.forEach(({ name, createState }) => {
    describe(`Backend: ${name}`, () => {
      it('mints distinct JWT sub/prof for same relayHostId and isolates grants between users', async () => {
        const { state, cleanup } = createState()
        const signingKey: RelayTokenSigningKey = await createRelayTokenSigningKey()

        // 1. Bootstrap Alice (Admin) and Invite + Activate Bob (User)
        const alicePw = await derivePasswordRecord(userAlice.password, TEST_FAST_PASSWORD_POLICY)
        const aliceAccount = await state.bootstrapAccount({
          email: userAlice.email,
          userId: userAlice.userId,
          profileId: userAlice.profileId,
          organizationId: userAlice.organizationId,
          passwordRecord: alicePw
        })

        const bobAccount = await state.inviteAccount({
          email: userBob.email,
          userId: userBob.userId,
          profileId: userBob.profileId,
          organizationId: userBob.organizationId
        })
        const bobPw = await derivePasswordRecord(userBob.password, TEST_FAST_PASSWORD_POLICY)
        const activateRes = await state.activateInvitedAccount(bobAccount.accountId, bobPw)
        expect(activateRes).toBe('ok')

        // 2. Start server driving the shipped HTTP endpoints
        const server = await listenOwnMobileRelay({
          origin: 'http://127.0.0.1',
          authOrigin: AUTH_ORIGIN,
          securityState: state,
          relayTokenSigningKey: signingKey,
          passwordPolicy: TEST_FAST_PASSWORD_POLICY
        })

        try {
          // 3. Obtain desktop access sessions via shipped PKCE flow for both users
          const aliceAccessToken = await loginAndObtainSessionToken(server.origin, {
            email: userAlice.email,
            password: userAlice.password,
            userId: userAlice.userId,
            profileId: userAlice.profileId,
            organizationId: userAlice.organizationId
          })

          const bobAccessToken = await loginAndObtainSessionToken(server.origin, {
            email: userBob.email,
            password: userBob.password,
            userId: userBob.userId,
            profileId: userBob.profileId,
            organizationId: userBob.organizationId
          })

          expect(aliceAccessToken).toBeTypeOf('string')
          expect(bobAccessToken).toBeTypeOf('string')
          expect(aliceAccessToken).not.toBe(bobAccessToken)

          // 4. Same relayHostId driven by both users
          const hostKeys = nacl.box.keyPair()
          const relayHostId = deriveRelayHostId(hostKeys.publicKey)

          const aliceGrantRes = await requestRelayToken(
            server.origin,
            aliceAccessToken,
            relayHostId,
            hostKeys.publicKey
          )
          const bobGrantRes = await requestRelayToken(
            server.origin,
            bobAccessToken,
            relayHostId,
            hostKeys.publicKey
          )

          const tokenAlice = aliceGrantRes.relayToken
          const tokenBob = bobGrantRes.relayToken

          expect(tokenAlice).not.toBe(tokenBob)

          // 5. Verify minted JWT claims: sub and prof are distinct and bound to the respective user
          const decodedAlice = decodeJwt(tokenAlice)
          const decodedBob = decodeJwt(tokenBob)

          expect(decodedAlice.sub).toBe(userAlice.userId)
          expect(decodedAlice.prof).toBe(userAlice.profileId)
          expect(decodedAlice.relayHostId).toBe(relayHostId)

          expect(decodedBob.sub).toBe(userBob.userId)
          expect(decodedBob.prof).toBe(userBob.profileId)
          expect(decodedBob.relayHostId).toBe(relayHostId)

          expect(decodedAlice.sub).not.toBe(decodedBob.sub)
          expect(decodedAlice.prof).not.toBe(decodedBob.prof)

          // 6. Verify with official RelayTokenVerifier against JWKS endpoint
          const verifier = createRelayTokenVerifier(
            relayVerifierConfig({
              jwksUrl: `${server.origin}/.well-known/jwks.json`,
              authIssuer: AUTH_ORIGIN
            })
          )

          const verifiedAlice = await verifier(tokenAlice)
          const verifiedBob = await verifier(tokenBob)

          expect(verifiedAlice).not.toBeNull()
          expect(verifiedAlice?.sub).toBe(userAlice.userId)
          expect(verifiedAlice?.prof).toBe(userAlice.profileId)
          expect(verifiedAlice?.relayHostId).toBe(relayHostId)

          expect(verifiedBob).not.toBeNull()
          expect(verifiedBob?.sub).toBe(userBob.userId)
          expect(verifiedBob?.prof).toBe(userBob.profileId)
          expect(verifiedBob?.relayHostId).toBe(relayHostId)

          // 7. Validate grants in security state: distinct grant IDs and account bindings
          const grantAlice = await state.validateRelayGrantByToken(tokenAlice)
          const grantBob = await state.validateRelayGrantByToken(tokenBob)

          expect(grantAlice).not.toBeNull()
          expect(grantBob).not.toBeNull()

          expect(grantAlice?.grantId).not.toBe(grantBob?.grantId)
          expect(grantAlice?.accountId).toBe(aliceAccount.accountId)
          expect(grantBob?.accountId).toBe(bobAccount.accountId)

          expect(grantAlice?.identity.userId).toBe(userAlice.userId)
          expect(grantAlice?.identity.profileId).toBe(userAlice.profileId)

          expect(grantBob?.identity.userId).toBe(userBob.userId)
          expect(grantBob?.identity.profileId).toBe(userBob.profileId)

          // Neither grant validates as the other user
          expect(grantAlice?.identity.userId).not.toBe(grantBob?.identity.userId)
          expect(grantAlice?.identity.profileId).not.toBe(grantBob?.identity.profileId)
          expect(grantAlice?.parentSessionId).not.toBe(grantBob?.parentSessionId)

          // 8. Grant validation by ID isolates relayHostId and users
          const grantAliceById = await state.validateRelayGrantById(
            grantAlice!.grantId,
            relayHostId
          )
          const grantBobById = await state.validateRelayGrantById(grantBob!.grantId, relayHostId)

          expect(grantAliceById?.grantId).toBe(grantAlice?.grantId)
          expect(grantBobById?.grantId).toBe(grantBob?.grantId)
          expect(grantAliceById?.identity.userId).toBe(userAlice.userId)
          expect(grantBobById?.identity.userId).toBe(userBob.userId)

          // Cross-host verification fails
          const wrongHostGrant = await state.validateRelayGrantById(
            grantAlice!.grantId,
            'wrong-host-id-12'
          )
          expect(wrongHostGrant).toBeNull()

          // 9. Lifecycle isolation: Alice logout invalidates Alice's grant but Bob's grant stays valid
          const logoutRes = await fetch(`${server.origin}/v1/desktop/auth/logout`, {
            method: 'POST',
            headers: {
              authorization: `Bearer ${aliceAccessToken}`,
              'content-type': 'application/json'
            }
          })
          expect(logoutRes.status).toBe(200)

          const grantAliceAfterLogout = await state.validateRelayGrantByToken(tokenAlice)
          const grantBobAfterAliceLogout = await state.validateRelayGrantByToken(tokenBob)

          expect(grantAliceAfterLogout).toBeNull()
          expect(grantBobAfterAliceLogout).not.toBeNull()
          expect(grantBobAfterAliceLogout?.grantId).toBe(grantBob?.grantId)
          expect(grantBobAfterAliceLogout?.identity.userId).toBe(userBob.userId)

          // 10. Lifecycle isolation: Bob password reset invalidates Bob's grant without affecting Alice
          // Alice logs back in to obtain a fresh session and grant
          const aliceAccessToken2 = await loginAndObtainSessionToken(server.origin, {
            email: userAlice.email,
            password: userAlice.password,
            userId: userAlice.userId,
            profileId: userAlice.profileId,
            organizationId: userAlice.organizationId
          })
          const aliceGrantRes2 = await requestRelayToken(
            server.origin,
            aliceAccessToken2,
            relayHostId,
            hostKeys.publicKey
          )
          const tokenAlice2 = aliceGrantRes2.relayToken

          expect(await state.validateRelayGrantByToken(tokenAlice2)).not.toBeNull()
          expect(await state.validateRelayGrantByToken(tokenBob)).not.toBeNull()

          // Bob replaces password verifier (epoch bump)
          const bobNewPw = await derivePasswordRecord(
            'bob-new-password-789',
            TEST_FAST_PASSWORD_POLICY
          )
          const bobPassRec = await state.getAccountPasswordRecord(bobAccount.accountId)
          const replaceRes = await state.replacePasswordVerifier(bobAccount.accountId, {
            expectedVerifierVersion: bobPassRec!.verifierVersion,
            newPasswordRecord: bobNewPw
          })
          expect(replaceRes.ok).toBe(true)

          // Bob's grant is now invalid due to authEpoch mismatch, Alice's grant stays valid
          const grantBobAfterReset = await state.validateRelayGrantByToken(tokenBob)
          const grantAliceAfterBobReset = await state.validateRelayGrantByToken(tokenAlice2)

          expect(grantBobAfterReset).toBeNull()
          expect(grantAliceAfterBobReset).not.toBeNull()
          expect(grantAliceAfterBobReset?.identity.userId).toBe(userAlice.userId)

          // 11. Lifecycle isolation: Disabling Bob invalidates Bob's new grant while Alice remains unaffected
          // Bob logs back in with his new password and gets a grant
          const bobAccessToken2 = await loginAndObtainSessionToken(server.origin, {
            email: userBob.email,
            password: 'bob-new-password-789',
            userId: userBob.userId,
            profileId: userBob.profileId,
            organizationId: userBob.organizationId
          })
          const bobGrantRes2 = await requestRelayToken(
            server.origin,
            bobAccessToken2,
            relayHostId,
            hostKeys.publicKey
          )
          const tokenBob2 = bobGrantRes2.relayToken

          // Promote Bob to admin or add another admin so disabling Alice is allowed (disableAccount guards last_admin)
          // Bob is user role, so disableAccount succeeds
          const disableBobRes = await state.disableAccount(bobAccount.accountId)
          expect(disableBobRes).toBe('ok')

          // Bob's grant is immediately invalid because account status is 'disabled'
          const grantBobAfterDisable = await state.validateRelayGrantByToken(tokenBob2)
          const grantAliceAfterBobDisable = await state.validateRelayGrantByToken(tokenAlice2)

          expect(grantBobAfterDisable).toBeNull()
          expect(grantAliceAfterBobDisable).not.toBeNull()
          expect(grantAliceAfterBobDisable?.identity.userId).toBe(userAlice.userId)
        } finally {
          await server.close()
          await cleanup()
        }
      })
    })
  })
})
