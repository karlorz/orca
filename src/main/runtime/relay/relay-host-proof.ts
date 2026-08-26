import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import nacl from 'tweetnacl'

const HOST_PROOF_TRANSCRIPT_DOMAIN = 'orca-relay-host-proof/v1'
const HOST_CHALLENGE_PLAINTEXT_DOMAIN = 'orca-relay-host-challenge/v1'
// Covers routine NTP drift without extending the signed challenge window.
const RELAY_HOST_PROOF_CLOCK_SKEW_MS = 30_000
const MAX_HOST_PROOF_CHALLENGE_WINDOW_MS = 10_000
const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

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

function decodeCanonicalBase64(value: string, expectedBytes: number): Uint8Array | null {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    return null
  }
  const decoded = Buffer.from(value, 'base64')
  return decoded.byteLength === expectedBytes && decoded.toString('base64') === value
    ? decoded
    : null
}

function uint64(value: number): Uint8Array {
  const bytes = new Uint8Array(8)
  new DataView(bytes.buffer).setBigUint64(0, BigInt(value), false)
  return bytes
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
  const encodedName = textEncoder.encode(name)
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
    field('protocol', textEncoder.encode(HOST_PROOF_TRANSCRIPT_DOMAIN)),
    field('version', new Uint8Array([1])),
    field('relayOrigin', textEncoder.encode(input.relayOrigin)),
    field('relayEphemeralPublicKey', relayKey),
    field('challengeNonce', nonce),
    field('challengeId', textEncoder.encode(challengeId)),
    field('issuedAt', uint64(issuedAt)),
    field('expiresAt', uint64(expiresAt)),
    field('userId', textEncoder.encode(input.userId)),
    field('profileId', textEncoder.encode(input.profileId)),
    field('organizationId', textEncoder.encode(input.organizationId)),
    field('relayHostId', textEncoder.encode(input.relayHostId)),
    field('hostPublicKey', input.hostPublicKey),
    field('assignmentEpoch', uint64(input.assignmentEpoch)),
    field('previousGeneration', previousGeneration),
    field('resumeRequested', new Uint8Array([input.resumeRequested ? 1 : 0]))
  ])
}

export function createRelayHostChallenge(input: RelayHostChallengeCreateInput): RelayHostChallenge {
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
  const domain = textEncoder.encode(`${HOST_CHALLENGE_PLAINTEXT_DOMAIN}\0`)
  const plaintext = concat([domain, uint32(transcript.byteLength), transcript, secret])
  const ciphertext = nacl.box(plaintext, nonce, input.hostPublicKey, ephemeral.secretKey)
  return {
    challengeId,
    relayEphemeralPublicKeyB64: canonicalBase64(ephemeral.publicKey),
    nonceB64: canonicalBase64(nonce),
    ciphertextB64: canonicalBase64(ciphertext),
    expiresAt
  }
}

function equal(left: Uint8Array | undefined, right: Uint8Array): boolean {
  return Boolean(left && left.byteLength === right.byteLength && timingSafeEqual(left, right))
}

function parseTranscript(transcript: Uint8Array): Map<string, Uint8Array> | null {
  const fields = new Map<string, Uint8Array>()
  const view = new DataView(transcript.buffer, transcript.byteOffset, transcript.byteLength)
  let offset = 0
  try {
    while (offset < transcript.byteLength) {
      const nameLength = view.getUint32(offset, false)
      offset += 4
      const name = textDecoder.decode(transcript.slice(offset, offset + nameLength))
      offset += nameLength
      const valueLength = view.getUint32(offset, false)
      offset += 4
      if (fields.has(name) || offset + valueLength > transcript.byteLength) {
        return null
      }
      fields.set(name, transcript.slice(offset, offset + valueLength))
      offset += valueLength
    }
  } catch {
    return null
  }
  return offset === transcript.byteLength ? fields : null
}

function readUint64(value: Uint8Array | undefined): number | null {
  if (!value || value.byteLength !== 8) {
    return null
  }
  const parsed = new DataView(value.buffer, value.byteOffset, value.byteLength).getBigUint64(
    0,
    false
  )
  return parsed <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(parsed) : null
}

function validateTranscript(
  transcript: Uint8Array,
  challenge: RelayHostChallenge,
  context: RelayHostProofContext,
  relayKey: Uint8Array,
  nonce: Uint8Array
): boolean {
  const fields = parseTranscript(transcript)
  if (!fields || fields.size !== 16) {
    context.onInvalid?.('transcript-structure')
    return false
  }
  const now = (context.now ?? Date.now)()
  const issuedAt = readUint64(fields.get('issuedAt'))
  const expiresAt = readUint64(fields.get('expiresAt'))
  const previousGeneration = fields.get('previousGeneration')
  const expectedPrevious =
    context.previousGeneration === undefined ? new Uint8Array() : uint64(context.previousGeneration)
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
    ['protocol', equal(fields.get('protocol'), textEncoder.encode(HOST_PROOF_TRANSCRIPT_DOMAIN))],
    ['version', equal(fields.get('version'), new Uint8Array([1]))],
    ['relayOrigin', equal(fields.get('relayOrigin'), textEncoder.encode(context.relayOrigin))],
    ['relayEphemeralPublicKey', equal(fields.get('relayEphemeralPublicKey'), relayKey)],
    ['challengeNonce', equal(fields.get('challengeNonce'), nonce)],
    ['challengeId', equal(fields.get('challengeId'), textEncoder.encode(challenge.challengeId))],
    ['userId', equal(fields.get('userId'), textEncoder.encode(context.userId))],
    ['profileId', equal(fields.get('profileId'), textEncoder.encode(context.profileId))],
    [
      'organizationId',
      equal(fields.get('organizationId'), textEncoder.encode(context.organizationId))
    ],
    ['relayHostId', equal(fields.get('relayHostId'), textEncoder.encode(context.relayHostId))],
    ['hostPublicKey', equal(fields.get('hostPublicKey'), context.hostPublicKey)],
    ['assignmentEpoch', equal(fields.get('assignmentEpoch'), uint64(context.assignmentEpoch))],
    ['previousGeneration', equal(previousGeneration, expectedPrevious)],
    [
      'resumeRequested',
      equal(fields.get('resumeRequested'), new Uint8Array([context.resumeRequested ? 1 : 0]))
    ]
  ]
  const failed = checks.filter(([, ok]) => !ok).map(([name]) => name)
  if (failed.length > 0) {
    context.onInvalid?.(`transcript:${failed.join('+')}`)
    return false
  }
  return true
}

export function answerRelayHostChallenge(
  challenge: RelayHostChallenge,
  context: RelayHostProofContext
): string | null {
  const relayKey = decodeCanonicalBase64(challenge.relayEphemeralPublicKeyB64, 32)
  const nonce = decodeCanonicalBase64(challenge.nonceB64, 24)
  const ciphertext = Buffer.from(challenge.ciphertextB64, 'base64')
  if (!relayKey || !nonce || ciphertext.toString('base64') !== challenge.ciphertextB64) {
    return null
  }
  const plaintext = nacl.box.open(ciphertext, nonce, relayKey, context.hostSecretKey)
  if (!plaintext) {
    context.onInvalid?.('challenge-box-open')
    return null
  }
  const domain = textEncoder.encode(`${HOST_CHALLENGE_PLAINTEXT_DOMAIN}\0`)
  if (
    !equal(plaintext.slice(0, domain.byteLength), domain) ||
    plaintext.byteLength < domain.byteLength + 36
  ) {
    return null
  }
  const transcriptLength = new DataView(
    plaintext.buffer,
    plaintext.byteOffset + domain.byteLength,
    4
  ).getUint32(0, false)
  const transcriptStart = domain.byteLength + 4
  const secretStart = transcriptStart + transcriptLength
  if (secretStart + 32 !== plaintext.byteLength) {
    return null
  }
  const transcript = plaintext.slice(transcriptStart, secretStart)
  if (!validateTranscript(transcript, challenge, context, relayKey, nonce)) {
    return null
  }
  const secret = plaintext.slice(secretStart)
  return createHmac('sha256', secret)
    .update(textEncoder.encode(`${HOST_PROOF_TRANSCRIPT_DOMAIN}\0ack\0`))
    .update(transcript)
    .digest('base64')
}
