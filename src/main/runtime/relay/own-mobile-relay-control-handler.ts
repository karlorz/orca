import { randomBytes } from 'node:crypto'
import type { RawData, WebSocket } from 'ws'
import { computeRelayHostProofAck, createRelayHostChallenge } from './relay-host-proof'
import type { OwnMobileRelayIssuedToken } from './own-mobile-relay-http'

const INVITE_TOKEN_TTL_MS = 10 * 60 * 1000
const INVITE_MAX_ATTEMPTS = 8

export type OwnMobileRelayInviteRecord = {
  inviteToken: string
  relayHostId: string
  relayDeviceId: string
  expiresAt: number
  remainingAttempts: number
}

export type OwnMobileRelayControlContext = {
  advertisedOrigin: string
  silenceLimitMs: number
  invites?: Map<string, OwnMobileRelayInviteRecord>
  onActive?: (relayHostId: string, send: (msg: object) => void) => void
  onClose?: (relayHostId: string) => void
}

export function handleOwnMobileRelayHostControlSocket(
  ws: WebSocket,
  grant: OwnMobileRelayIssuedToken,
  options: OwnMobileRelayControlContext
): void {
  let state: 'waiting-hello' | 'waiting-challenge-ack' | 'active' | 'closed' = 'waiting-hello'
  let expectedChallengeId: string | null = null
  let expectedProof: string | null = null
  let silenceTimer: NodeJS.Timeout | null = null

  function resetSilenceWatchdog(): void {
    if (silenceTimer) {
      clearTimeout(silenceTimer)
    }
    silenceTimer = setTimeout(() => {
      closeSocket(4401, 'silence_timeout')
    }, options.silenceLimitMs)
    silenceTimer.unref?.()
  }

  function closeSocket(code: number, reason?: string): void {
    state = 'closed'
    if (silenceTimer) {
      clearTimeout(silenceTimer)
      silenceTimer = null
    }
    options.onClose?.(grant.relayHostId)
    ws.close(code, reason)
  }

  resetSilenceWatchdog()

  ws.once('error', () => {
    closeSocket(4401, 'socket_error')
  })

  ws.on('message', (raw: RawData, isBinary: boolean) => {
    resetSilenceWatchdog()
    if (isBinary) {
      closeSocket(4401, 'binary_frame_rejected')
      return
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(raw.toString('utf8'))
    } catch {
      closeSocket(4401, 'invalid_json')
      return
    }

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      closeSocket(4401, 'invalid_message')
      return
    }

    const msg = parsed as Record<string, unknown>

    if (state === 'waiting-hello') {
      if (
        msg.type !== 'host-hello' ||
        msg.v !== 1 ||
        typeof msg.relayHostId !== 'string' ||
        typeof msg.hostPublicKeyB64 !== 'string' ||
        typeof msg.assignmentEpoch !== 'number'
      ) {
        closeSocket(4401, 'invalid_host_hello')
        return
      }

      if (
        msg.relayHostId !== grant.relayHostId ||
        msg.hostPublicKeyB64 !== grant.hostPublicKeyB64 ||
        msg.assignmentEpoch !== 1
      ) {
        closeSocket(4401, 'host_hello_mismatch')
        return
      }

      const hostPublicKey = Buffer.from(grant.hostPublicKeyB64, 'base64')
      const previousGeneration =
        typeof msg.previousGeneration === 'number' ? msg.previousGeneration : undefined
      const resumeRequested = typeof msg.controlResumeSecret === 'string'

      const challengeInput = {
        relayOrigin: options.advertisedOrigin,
        userId: grant.identity.userId,
        profileId: grant.identity.profileId,
        organizationId: grant.identity.organizationId,
        relayHostId: grant.relayHostId,
        hostPublicKey,
        assignmentEpoch: 1,
        previousGeneration,
        resumeRequested
      }

      const challenge = createRelayHostChallenge(challengeInput)
      expectedChallengeId = challenge.challengeId
      expectedProof = computeRelayHostProofAck(challenge.secret, challenge.transcript)
      state = 'waiting-challenge-ack'

      ws.send(
        JSON.stringify({
          type: 'host-challenge',
          challengeId: challenge.challengeId,
          relayEphemeralPublicKeyB64: challenge.relayEphemeralPublicKeyB64,
          nonceB64: challenge.nonceB64,
          ciphertextB64: challenge.ciphertextB64,
          expiresAt: challenge.expiresAt
        })
      )
      return
    }

    if (state === 'waiting-challenge-ack') {
      if (
        msg.type !== 'host-challenge-ack' ||
        typeof msg.challengeId !== 'string' ||
        typeof msg.proofB64 !== 'string'
      ) {
        closeSocket(4401, 'invalid_challenge_ack')
        return
      }

      if (msg.challengeId !== expectedChallengeId || msg.proofB64 !== expectedProof) {
        closeSocket(4401, 'proof_mismatch')
        return
      }

      state = 'active'
      const controlResumeSecret = randomBytes(32).toString('base64url')
      const leaseExpiresAt = Date.now() + 60_000

      options.onActive?.(grant.relayHostId, (msg: object) => {
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify(msg))
        }
      })

      ws.send(
        JSON.stringify({
          type: 'host-hello-ack',
          v: 1,
          generation: 1,
          controlResumeSecret,
          leaseExpiresAt,
          activeConnIds: [],
          pendingConns: []
        })
      )
      return
    }

    if (state === 'active') {
      if (msg.type === 'ping' && typeof msg.t === 'number') {
        ws.send(JSON.stringify({ type: 'pong', t: msg.t }))
        return
      }

      if (
        msg.type === 'invite-create' &&
        typeof msg.reqId === 'string' &&
        typeof msg.relayDeviceId === 'string'
      ) {
        const inviteToken = randomBytes(32).toString('base64url')
        const expiresAt = Date.now() + INVITE_TOKEN_TTL_MS
        const maxAttempts = INVITE_MAX_ATTEMPTS
        if (options.invites) {
          options.invites.set(inviteToken, {
            inviteToken,
            relayHostId: grant.relayHostId,
            relayDeviceId: msg.relayDeviceId,
            expiresAt,
            remainingAttempts: maxAttempts
          })
        }
        ws.send(
          JSON.stringify({
            type: 'invite-created',
            reqId: msg.reqId,
            inviteToken,
            expiresAt,
            maxAttempts
          })
        )
        return
      }

      closeSocket(4401, 'unknown_control_message')
      return
    }

    closeSocket(4401, 'invalid_state')
  })
}
