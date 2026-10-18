export const MAX_AUDIT_EVENTS = 10000

export const ALLOWLISTED_AUDIT_FIELD_KEYS = new Set([
  'relayHostId',
  'deviceId',
  'grantId',
  'sessionId',
  'closeCode',
  'reason',
  'actor',
  'hostControlLive',
  'count',
  'accountId',
  'email',
  'actorAccountId'
] as const)

export type AllowlistedAuditFieldKey =
  | 'relayHostId'
  | 'deviceId'
  | 'grantId'
  | 'sessionId'
  | 'closeCode'
  | 'reason'
  | 'actor'
  | 'hostControlLive'
  | 'count'
  | 'accountId'
  | 'email'
  | 'actorAccountId'

export const DISALLOWED_AUDIT_KEY_PATTERN =
  /token|password|cookie|secret|bearer|authorization|resume|ciphertext|pairing|plaintext|payload|e2ee/i

function isRelaySecretKey(key: string): boolean {
  if (key === 'authorizationMode' || key === 'resumeExpiresAt' || key === 'graceExpiresAt') {
    return false
  }
  return DISALLOWED_AUDIT_KEY_PATTERN.test(key)
}

function isRelaySecretValue(value: string): boolean {
  if (/[?&](?:token|code|password)=/i.test(value) || /^orca:\/\//i.test(value)) {
    return true
  }
  try {
    const url = new URL(value)
    return /pairing/i.test(`${url.pathname}${url.search}${url.hash}`)
  } catch {
    return false
  }
}

function isBinaryPayload(value: unknown): boolean {
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) {
    return true
  }
  return value instanceof Uint8Array
}

function stripRelaySecrets(value: unknown, key = ''): unknown {
  if (key.length > 0 && isRelaySecretKey(key)) {
    return undefined
  }
  if (isBinaryPayload(value)) {
    return undefined
  }
  if (typeof value === 'string' && isRelaySecretValue(value)) {
    return undefined
  }
  if (Array.isArray(value)) {
    return value.map((item) => stripRelaySecrets(item))
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [childKey, child] of Object.entries(value)) {
      const next = stripRelaySecrets(child, childKey)
      if (next !== undefined) {
        out[childKey] = next
      }
    }
    return out
  }
  return value
}

export function omitRelaySecrets<T>(value: T): T {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: Operator snapshots are JSON DTOs whose required public fields survive redaction.
  return JSON.parse(JSON.stringify(stripRelaySecrets(value))) as T
}

export type AuditFieldValue = string | number | boolean | null

export type AuditFieldRecord = Record<string, AuditFieldValue>

export type OwnMobileRelayAuditEvent = {
  at: number
  type: string
  fields: AuditFieldRecord
}

export type OwnMobileRelayAuditListOptions = {
  since?: number
  type?: string
  limit?: number
  order?: 'asc' | 'desc'
}

export function sanitizeAuditFields(rawFields?: Record<string, unknown> | null): AuditFieldRecord {
  if (!rawFields || typeof rawFields !== 'object') {
    return {}
  }

  const sanitized: AuditFieldRecord = {}

  for (const [key, val] of Object.entries(rawFields)) {
    if (!ALLOWLISTED_AUDIT_FIELD_KEYS.has(key as AllowlistedAuditFieldKey)) {
      continue
    }

    if (DISALLOWED_AUDIT_KEY_PATTERN.test(key)) {
      continue
    }

    if (typeof val === 'string' && isRelaySecretValue(val)) {
      continue
    }

    if (
      val === null ||
      typeof val === 'string' ||
      typeof val === 'number' ||
      typeof val === 'boolean'
    ) {
      sanitized[key] = val
    }
  }

  return sanitized
}

export type OwnMobileRelayAuditLog = {
  append(event: OwnMobileRelayAuditEvent): Promise<void>
  list(options?: OwnMobileRelayAuditListOptions): Promise<OwnMobileRelayAuditEvent[]>
}
