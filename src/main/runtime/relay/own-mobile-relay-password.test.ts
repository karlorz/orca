import { describe, expect, it } from 'vitest'
import {
  derivePasswordRecord,
  verifyPasswordRecord,
  validatePasswordCandidate,
  CURRENT_PASSWORD_POLICY,
  type PasswordRecord,
  type PasswordPolicy,
  MIN_SALT_LENGTH_BYTES,
  TEST_FAST_PASSWORD_POLICY
} from './own-mobile-relay-password'

describe('own-mobile-relay-password', () => {
  it('derives a record containing policy version, random salt, derived verifier, and explicit cost parameters without raw password', async () => {
    const fixturePassword = 'correct-horse-battery-staple-fixture'
    const record = await derivePasswordRecord(fixturePassword)

    expect(record.version).toBe(CURRENT_PASSWORD_POLICY.version)
    expect(typeof record.salt).toBe('string')
    expect(typeof record.verifier).toBe('string')
    expect(record.params).toEqual({
      N: CURRENT_PASSWORD_POLICY.params.N,
      r: CURRENT_PASSWORD_POLICY.params.r,
      p: CURRENT_PASSWORD_POLICY.params.p,
      keyLen: CURRENT_PASSWORD_POLICY.params.keyLen,
      maxmem: CURRENT_PASSWORD_POLICY.params.maxmem
    })
    expect((record as unknown as Record<string, unknown>).password).toBeUndefined()
    expect((record as unknown as Record<string, unknown>).rawPassword).toBeUndefined()
    expect(Buffer.from(record.salt, 'base64url').length).toBeGreaterThanOrEqual(16)
    expect(Buffer.from(record.verifier, 'base64url').length).toBe(32)
  })

  it('accepts the correct password and rejects a wrong password', async () => {
    const fixturePassword = 'correct-horse-battery-staple-fixture'
    const wrongPassword = 'wrong-horse-battery-staple-fixture'
    const record = await derivePasswordRecord(fixturePassword)

    const correctResult = await verifyPasswordRecord(fixturePassword, record)
    expect(correctResult.valid).toBe(true)

    const wrongResult = await verifyPasswordRecord(wrongPassword, record)
    expect(wrongResult.valid).toBe(false)
  })

  it('treats malformed records as failure without throwing exceptions to callers', async () => {
    const fixturePassword = 'correct-horse-battery-staple-fixture'

    const malformedCases: unknown[] = [
      null,
      undefined,
      {},
      { version: 1 },
      { version: 1, salt: 'abc' },
      { version: 1, salt: 'abc', verifier: 'def' },
      { version: 1, salt: 'abc', verifier: 'def', params: null },
      {
        version: 1,
        salt: 'abc',
        verifier: 'def',
        params: { N: -1, r: 8, p: 1, keyLen: 32, maxmem: 64 }
      },
      { version: 1, salt: 123, verifier: 'def', params: CURRENT_PASSWORD_POLICY.params },
      { version: 1, salt: 'abc', verifier: 123, params: CURRENT_PASSWORD_POLICY.params },
      { version: '1', salt: 'abc', verifier: 'def', params: CURRENT_PASSWORD_POLICY.params }
    ]

    for (const badRecord of malformedCases) {
      const result = await verifyPasswordRecord(fixturePassword, badRecord as PasswordRecord)
      expect(result).toEqual({ valid: false, needsRehash: false })
    }
  })

  it('rejects passwords shorter than 14 or longer than 1024 code units, and accepts valid long passphrases without composition rules', async () => {
    expect(validatePasswordCandidate('short-pw')).toBe(false)
    expect(validatePasswordCandidate('1234567890123')).toBe(false) // 13 chars
    expect(validatePasswordCandidate('12345678901234')).toBe(true) // 14 chars (minimum)

    const longPassphrase = 'all lowercase passphrase without numbers or symbols is valid'
    expect(validatePasswordCandidate(longPassphrase)).toBe(true)

    const maxPassphrase = 'a'.repeat(1024)
    expect(validatePasswordCandidate(maxPassphrase)).toBe(true)

    const tooLongPassphrase = 'a'.repeat(1025)
    expect(validatePasswordCandidate(tooLongPassphrase)).toBe(false)

    await expect(derivePasswordRecord('short-pw')).rejects.toThrow(/password length/i)
  })

  it('reports that rehash is required after successful verification for an older supported policy or differing parameters', async () => {
    const fixturePassword = 'correct-horse-battery-staple-fixture'
    const legacyPolicy: PasswordPolicy = {
      version: 0,
      params: {
        N: 16384,
        r: 8,
        p: 1,
        keyLen: 32,
        maxmem: 64 * 1024 * 1024
      }
    }

    const legacyRecord = await derivePasswordRecord(fixturePassword, legacyPolicy)
    const result = await verifyPasswordRecord(fixturePassword, legacyRecord)

    expect(result.valid).toBe(true)
    expect(result.needsRehash).toBe(true)

    const currentRecord = await derivePasswordRecord(fixturePassword, CURRENT_PASSWORD_POLICY)
    const currentResult = await verifyPasswordRecord(fixturePassword, currentRecord)
    expect(currentResult.valid).toBe(true)
    expect(currentResult.needsRehash).toBe(false)
  })

  it('defines exact production policy constants (N=32768, r=8, p=1, keyLen=32, saltLen>=16, maxmem=64MiB)', () => {
    expect(CURRENT_PASSWORD_POLICY.version).toBe(1)
    expect(CURRENT_PASSWORD_POLICY.params.N).toBe(32768)
    expect(CURRENT_PASSWORD_POLICY.params.r).toBe(8)
    expect(CURRENT_PASSWORD_POLICY.params.p).toBe(1)
    expect(CURRENT_PASSWORD_POLICY.params.keyLen).toBe(32)
    expect(CURRENT_PASSWORD_POLICY.params.maxmem).toBe(64 * 1024 * 1024) // 64 MiB = 67,108,864 bytes
    expect(MIN_SALT_LENGTH_BYTES).toBeGreaterThanOrEqual(16)
  })

  it('allows tests to inject a lower-cost policy without altering production constants', async () => {
    const fixturePassword = 'correct-horse-battery-staple-fixture'
    expect(TEST_FAST_PASSWORD_POLICY.params.N).toBeLessThan(CURRENT_PASSWORD_POLICY.params.N)

    const record = await derivePasswordRecord(fixturePassword, TEST_FAST_PASSWORD_POLICY)
    expect(record.params.N).toBe(TEST_FAST_PASSWORD_POLICY.params.N)

    const result = await verifyPasswordRecord(fixturePassword, record, TEST_FAST_PASSWORD_POLICY)
    expect(result.valid).toBe(true)
    expect(result.needsRehash).toBe(false)

    // Verify against production policy reports rehash needed
    const prodResult = await verifyPasswordRecord(fixturePassword, record, CURRENT_PASSWORD_POLICY)
    expect(prodResult.valid).toBe(true)
    expect(prodResult.needsRehash).toBe(true)

    // Production policy constant remains untouched
    expect(CURRENT_PASSWORD_POLICY.params.N).toBe(32768)
  })
})
