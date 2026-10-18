import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'

function scryptPromise(
  password: string | Buffer,
  salt: string | Buffer,
  keyLen: number,
  options: { N: number; r: number; p: number; maxmem: number }
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLen, options, (err, derivedKey) => {
      if (err) {
        reject(err)
      } else {
        resolve(derivedKey as Buffer)
      }
    })
  })
}

export const MIN_PASSWORD_LENGTH = 1
export const MAX_PASSWORD_LENGTH = 1024
export const MIN_SALT_LENGTH_BYTES = 16

export type PasswordScryptParams = {
  readonly N: number
  readonly r: number
  readonly p: number
  readonly keyLen: number
  readonly maxmem: number
}

export type PasswordPolicy = {
  readonly version: number
  readonly params: PasswordScryptParams
}

export type PasswordRecord = {
  readonly version: number
  readonly salt: string
  readonly verifier: string
  readonly params: PasswordScryptParams
}

export type VerifyPasswordResult = {
  readonly valid: boolean
  readonly needsRehash: boolean
}

export const CURRENT_PASSWORD_POLICY: PasswordPolicy = {
  version: 1,
  params: {
    N: 32768,
    r: 8,
    p: 1,
    keyLen: 32,
    maxmem: 64 * 1024 * 1024
  }
}

export const TEST_FAST_PASSWORD_POLICY: PasswordPolicy = {
  version: 1,
  params: {
    N: 1024,
    r: 8,
    p: 1,
    keyLen: 32,
    maxmem: 64 * 1024 * 1024
  }
}

export function validatePasswordCandidate(password: string): boolean {
  if (typeof password !== 'string') {
    return false
  }
  return password.length >= MIN_PASSWORD_LENGTH && password.length <= MAX_PASSWORD_LENGTH
}

function isValidPasswordRecord(record: unknown): record is PasswordRecord {
  if (!record || typeof record !== 'object') {
    return false
  }

  const candidate = record as Partial<PasswordRecord>
  if (
    typeof candidate.version !== 'number' ||
    typeof candidate.salt !== 'string' ||
    typeof candidate.verifier !== 'string' ||
    !candidate.params ||
    typeof candidate.params !== 'object'
  ) {
    return false
  }

  const { N, r, p, keyLen, maxmem } = candidate.params
  if (
    typeof N !== 'number' ||
    N <= 1 ||
    (N & (N - 1)) !== 0 ||
    typeof r !== 'number' ||
    r <= 0 ||
    typeof p !== 'number' ||
    p <= 0 ||
    typeof keyLen !== 'number' ||
    keyLen <= 0 ||
    typeof maxmem !== 'number' ||
    maxmem <= 0
  ) {
    return false
  }

  return true
}

export async function derivePasswordRecord(
  password: string,
  policy: PasswordPolicy = CURRENT_PASSWORD_POLICY
): Promise<PasswordRecord> {
  if (!validatePasswordCandidate(password)) {
    throw new Error(
      `Password length must be between ${MIN_PASSWORD_LENGTH} and ${MAX_PASSWORD_LENGTH} characters`
    )
  }

  const saltBytes = randomBytes(16)
  const verifierBuffer = await scryptPromise(password, saltBytes, policy.params.keyLen, {
    N: policy.params.N,
    r: policy.params.r,
    p: policy.params.p,
    maxmem: policy.params.maxmem
  })

  return {
    version: policy.version,
    salt: saltBytes.toString('base64url'),
    verifier: verifierBuffer.toString('base64url'),
    params: {
      N: policy.params.N,
      r: policy.params.r,
      p: policy.params.p,
      keyLen: policy.params.keyLen,
      maxmem: policy.params.maxmem
    }
  }
}

export async function verifyPasswordRecord(
  password: string,
  record: PasswordRecord,
  currentPolicy: PasswordPolicy = CURRENT_PASSWORD_POLICY
): Promise<VerifyPasswordResult> {
  if (!isValidPasswordRecord(record)) {
    return { valid: false, needsRehash: false }
  }

  try {
    const salt = Buffer.from(record.salt, 'base64url')
    const expectedVerifier = Buffer.from(record.verifier, 'base64url')
    if (salt.length === 0 || expectedVerifier.length === 0) {
      return { valid: false, needsRehash: false }
    }

    const candidateVerifier = await scryptPromise(password, salt, record.params.keyLen, {
      N: record.params.N,
      r: record.params.r,
      p: record.params.p,
      maxmem: record.params.maxmem
    })

    const valid =
      candidateVerifier.length === expectedVerifier.length &&
      timingSafeEqual(candidateVerifier, expectedVerifier)

    if (!valid) {
      return { valid: false, needsRehash: false }
    }

    const needsRehash =
      record.version !== currentPolicy.version ||
      record.params.N !== currentPolicy.params.N ||
      record.params.r !== currentPolicy.params.r ||
      record.params.p !== currentPolicy.params.p ||
      record.params.keyLen !== currentPolicy.params.keyLen ||
      record.params.maxmem !== currentPolicy.params.maxmem

    return {
      valid: true,
      needsRehash
    }
  } catch {
    return { valid: false, needsRehash: false }
  }
}
