import { randomBytes } from 'node:crypto'
import nacl from 'tweetnacl'
import {
  encodeText,
  encodeUint64,
  equalBytes,
  hostChallengeAckProof,
  openHostChallengeEnvelope,
  parseHostChallengeTranscript,
  readTranscriptUint64
} from '../host-challenge-envelope'

const HOST_PROOF_TRANSCRIPT_DOMAIN = 'orca-relay-host-proof/v1'
const HOST_CHALLENGE_PLAINTEXT_DOMAIN = 'orca-relay-host-challenge/v1'
// Covers routine NTP drift without extending the signed challenge window.
const RELAY_HOST_PROOF_CLOCK_SKEW_MS = 30_000
const MAX_HOST_PROOF_CHALLENGE_WINDOW_MS = 10_000

export type RelayHostChallenge = {
  challengeId: string
  relayEphemeralPublicKeyB64: string
  nonceB64: string
  ciphertextB64: string
  expiresAt: number
}

export type RelayHostChallengeCreateInput = {
  relayOrigin: string
  userId: string
  profileId: string
  organizationId: string
  relayHostId: string
  hostPublicKey: Uint8Array
  assignmentEpoch: number
  previousGeneration?: number
  resumeRequested: boolean
  now?: () => number
  challengeId?: string
}

export type RelayHostProofContext = {
  relayOrigin: string
  userId: string
  profileId: string
  organizationId: string
  relayHostId: string
  hostPublicKey: Uint8Array
  hostSecretKey: Uint8Array
  assignmentEpoch: number
  previousGeneration?: number
  resumeRequested: boolean
  now?: () => number
  /** Reports the failing check by name only; never receives field values. */
  onInvalid?: (reason: string) => void
}

function uint64(value: number): Uint8Array {
  return encodeUint64(value)
}

function uint32(value: number): Uint8Array {
  const bytes = new Uint8Array(4)
  new DataView(bytes.buffer).setUint32(0, value, false)
  return bytes
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0))
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.byteLength
  }
  return output
}

function field(name: string, value: Uint8Array): Uint8Array {
  const encodedName = encodeText(name)
  return concat([uint32(encodedName.byteLength), encodedName, uint32(value.byteLength), value])
}

function canonicalBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
}

function encodeTranscript(
  input: RelayHostChallengeCreateInput,
  issuedAt: number,
  expiresAt: number,
  relayKey: Uint8Array,
  nonce: Uint8Array,
  challengeId: string
): Uint8Array {
  const previousGeneration =
    input.previousGeneration === undefined ? new Uint8Array() : uint64(input.previousGeneration)
  return concat([
    field('protocol', encodeText(HOST_PROOF_TRANSCRIPT_DOMAIN)),
    field('version', new Uint8Array([1])),
    field('relayOrigin', encodeText(input.relayOrigin)),
    field('relayEphemeralPublicKey', relayKey),
    field('challengeNonce', nonce),
    field('challengeId', encodeText(challengeId)),
    field('issuedAt', uint64(issuedAt)),
    field('expiresAt', uint64(expiresAt)),
    field('userId', encodeText(input.userId)),
    field('profileId', encodeText(input.profileId)),
    field('organizationId', encodeText(input.organizationId)),
    field('relayHostId', encodeText(input.relayHostId)),
    field('hostPublicKey', input.hostPublicKey),
    field('assignmentEpoch', uint64(input.assignmentEpoch)),
    field('previousGeneration', previousGeneration),
    field('resumeRequested', new Uint8Array([input.resumeRequested ? 1 : 0]))
  ])
}

export function createRelayHostChallenge(
  input: RelayHostChallengeCreateInput
): RelayHostChallenge & {
  secret: Uint8Array
  transcript: Uint8Array
} {
  const issuedAt = (input.now ?? Date.now)()
  const expiresAt = issuedAt + MAX_HOST_PROOF_CHALLENGE_WINDOW_MS
  const challengeId = input.challengeId ?? randomBytes(16).toString('hex')
  const ephemeral = nacl.box.keyPair()
  const nonce = new Uint8Array(randomBytes(24))
  const secret = new Uint8Array(randomBytes(32))
  const transcript = encodeTranscript(
    input,
    issuedAt,
    expiresAt,
    ephemeral.publicKey,
    nonce,
    challengeId
  )
  const domain = encodeText(`${HOST_CHALLENGE_PLAINTEXT_DOMAIN}\0`)
  const plaintext = concat([domain, uint32(transcript.byteLength), transcript, secret])
  const ciphertext = nacl.box(plaintext, nonce, input.hostPublicKey, ephemeral.secretKey)
  return {
    challengeId,
    relayEphemeralPublicKeyB64: canonicalBase64(ephemeral.publicKey),
    nonceB64: canonicalBase64(nonce),
    ciphertextB64: canonicalBase64(ciphertext),
    expiresAt,
    secret,
    transcript
  }
}

function validateTranscript(
  transcript: Uint8Array,
  challenge: RelayHostChallenge,
  context: RelayHostProofContext,
  relayKey: Uint8Array,
  nonce: Uint8Array
): boolean {
  const fields = parseHostChallengeTranscript(transcript)
  if (!fields || fields.size !== 16) {
    context.onInvalid?.('transcript-structure')
    return false
  }
  const now = (context.now ?? Date.now)()
  const issuedAt = readTranscriptUint64(fields.get('issuedAt'))
  const expiresAt = readTranscriptUint64(fields.get('expiresAt'))
  const previousGeneration = fields.get('previousGeneration')
  const expectedPrevious =
    context.previousGeneration === undefined
      ? new Uint8Array()
      : encodeUint64(context.previousGeneration)
  // Main's 30s skew bounds with named-check reporting kept from the incident
  // instrumentation; deltas are relative offsets only, never absolute values.
  const checks: [string, boolean][] = [
    ['issuedAt-readable', issuedAt !== null],
    [
      `issuedAt-not-future(d=${issuedAt === null ? 'n/a' : issuedAt - now}ms)`,
      issuedAt === null || issuedAt - RELAY_HOST_PROOF_CLOCK_SKEW_MS <= now
    ],
    [
      `not-expired(d=${challenge.expiresAt - now}ms)`,
      now - RELAY_HOST_PROOF_CLOCK_SKEW_MS <= challenge.expiresAt
    ],
    ['issuedAt-before-expiry', issuedAt === null || issuedAt <= challenge.expiresAt],
    [
      `window(w=${issuedAt === null ? 'n/a' : challenge.expiresAt - issuedAt}ms)`,
      issuedAt === null || challenge.expiresAt - issuedAt <= MAX_HOST_PROOF_CHALLENGE_WINDOW_MS
    ],
    ['expiry-consistent', expiresAt === challenge.expiresAt],
    ['protocol', equalBytes(fields.get('protocol'), encodeText(HOST_PROOF_TRANSCRIPT_DOMAIN))],
    ['version', equalBytes(fields.get('version'), new Uint8Array([1]))],
    ['relayOrigin', equalBytes(fields.get('relayOrigin'), encodeText(context.relayOrigin))],
    ['relayEphemeralPublicKey', equalBytes(fields.get('relayEphemeralPublicKey'), relayKey)],
    ['challengeNonce', equalBytes(fields.get('challengeNonce'), nonce)],
    ['challengeId', equalBytes(fields.get('challengeId'), encodeText(challenge.challengeId))],
    ['userId', equalBytes(fields.get('userId'), encodeText(context.userId))],
    ['profileId', equalBytes(fields.get('profileId'), encodeText(context.profileId))],
    [
      'organizationId',
      equalBytes(fields.get('organizationId'), encodeText(context.organizationId))
    ],
    ['relayHostId', equalBytes(fields.get('relayHostId'), encodeText(context.relayHostId))],
    ['hostPublicKey', equalBytes(fields.get('hostPublicKey'), context.hostPublicKey)],
    [
      'assignmentEpoch',
      equalBytes(fields.get('assignmentEpoch'), encodeUint64(context.assignmentEpoch))
    ],
    ['previousGeneration', equalBytes(previousGeneration, expectedPrevious)],
    [
      'resumeRequested',
      equalBytes(fields.get('resumeRequested'), new Uint8Array([context.resumeRequested ? 1 : 0]))
    ]
  ]
  const failed = checks.filter(([, ok]) => !ok).map(([name]) => name)
  if (failed.length > 0) {
    context.onInvalid?.(`transcript:${failed.join('+')}`)
    return false
  }
  return true
}

export function computeRelayHostProofAck(secret: Uint8Array, transcript: Uint8Array): string {
  return hostChallengeAckProof({
    secret,
    transcript,
    proofDomain: HOST_PROOF_TRANSCRIPT_DOMAIN
  })
}

export function answerRelayHostChallenge(
  challenge: RelayHostChallenge,
  context: RelayHostProofContext
): string | null {
  const envelope = openHostChallengeEnvelope({
    peerEphemeralPublicKeyB64: challenge.relayEphemeralPublicKeyB64,
    nonceB64: challenge.nonceB64,
    ciphertextB64: challenge.ciphertextB64,
    hostSecretKey: context.hostSecretKey,
    plaintextDomain: HOST_CHALLENGE_PLAINTEXT_DOMAIN,
    onInvalid: context.onInvalid
  })
  if (
    !envelope ||
    !validateTranscript(
      envelope.transcript,
      challenge,
      context,
      envelope.peerEphemeralPublicKey,
      envelope.nonce
    )
  ) {
    return null
  }
  return computeRelayHostProofAck(envelope.secret, envelope.transcript)
}
