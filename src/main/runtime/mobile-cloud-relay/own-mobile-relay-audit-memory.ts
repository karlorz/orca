import {
  MAX_AUDIT_EVENTS,
  sanitizeAuditFields,
  type OwnMobileRelayAuditEvent,
  type OwnMobileRelayAuditListOptions,
  type OwnMobileRelayAuditLog
} from './own-mobile-relay-audit'

export function createOwnMobileRelayAuditMemory(
  maxEvents: number = MAX_AUDIT_EVENTS
): OwnMobileRelayAuditLog {
  const events: OwnMobileRelayAuditEvent[] = []

  return {
    async append(event: OwnMobileRelayAuditEvent): Promise<void> {
      const sanitizedEvent: OwnMobileRelayAuditEvent = {
        at: event.at,
        type: event.type,
        fields: sanitizeAuditFields(event.fields)
      }

      events.push(sanitizedEvent)
      if (events.length > maxEvents) {
        events.splice(0, events.length - maxEvents)
      }
    },

    async list(options: OwnMobileRelayAuditListOptions = {}): Promise<OwnMobileRelayAuditEvent[]> {
      const { since, type, limit, order = 'asc' } = options

      const result =
        since !== undefined || type !== undefined
          ? events.filter((e) => {
              if (since !== undefined && e.at < since) {
                return false
              }
              if (type !== undefined && e.type !== type) {
                return false
              }
              return true
            })
          : events.slice()

      if (order === 'desc') {
        result.reverse()
      }

      if (limit !== undefined && Number.isFinite(limit) && limit >= 0) {
        return result.slice(0, Math.floor(limit))
      }
      return result
    }
  }
}
