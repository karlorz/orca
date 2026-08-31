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
  'count'
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

export const DISALLOWED_AUDIT_KEY_PATTERN =
  /token|password|cookie|secret|bearer|authorization|resume|ciphertext/i

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
