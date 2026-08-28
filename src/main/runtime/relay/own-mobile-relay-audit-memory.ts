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
      const { since, type, limit } = options

      let result = events

      if (since !== undefined || type !== undefined) {
        result = result.filter((e) => {
          if (since !== undefined && e.at < since) {
            return false
          }
          if (type !== undefined && e.type !== type) {
            return false
          }
          return true
        })
      }

      if (limit !== undefined && limit >= 0 && result.length > limit) {
        return result.slice(0, limit)
      }
      return result === events ? [...events] : result
    }
  }
}
