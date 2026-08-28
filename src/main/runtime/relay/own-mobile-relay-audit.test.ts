import { describe, expect, it } from 'vitest'
import {
  MAX_AUDIT_EVENTS,
  sanitizeAuditFields,
  type OwnMobileRelayAuditEvent
} from './own-mobile-relay-audit'
import { createOwnMobileRelayAuditMemory } from './own-mobile-relay-audit-memory'

describe('own-mobile-relay-audit', () => {
  describe('sanitizeAuditFields', () => {
    it('keeps allowlisted primitive fields', () => {
      const input = {
        relayHostId: 'host-1',
        deviceId: 'dev-1',
        grantId: 'grant-1',
        sessionId: 'sess-1',
        closeCode: 1000,
        reason: 'normal_close',
        actor: 'user',
        hostControlLive: true,
        count: 42
      }
      expect(sanitizeAuditFields(input)).toEqual(input)
    })

    it('drops disallowed keys and sensitive pattern matching keys', () => {
      const input = {
        relayHostId: 'host-1',
        accessToken: 'secret-token',
        password: 'super-password',
        cookie: 'session-cookie',
        secretKey: 'key',
        bearerAuth: 'bearer-xyz',
        authorization: 'Basic abc',
        resumeToken: 'resume-123',
        ciphertext: 'encrypted-blob',
        unknownCustomKey: 'some-value',
        rawObject: { nested: 'val' }
      }
      expect(sanitizeAuditFields(input)).toEqual({
        relayHostId: 'host-1'
      })
    })

    it('drops non-primitive values even for allowlisted keys', () => {
      const input = {
        relayHostId: { nested: 'bad' } as unknown as string,
        sessionId: 'sess-1'
      }
      expect(sanitizeAuditFields(input)).toEqual({
        sessionId: 'sess-1'
      })
    })
  })

  describe('OwnMobileRelayAuditLog memory adapter', () => {
    it('1. append + list returns the event', async () => {
      const audit = createOwnMobileRelayAuditMemory()
      const event: OwnMobileRelayAuditEvent = {
        at: 1700000000000,
        type: 'session.created',
        fields: {
          sessionId: 'sess-1',
          actor: 'admin',
          count: 1
        }
      }

      await audit.append(event)
      const events = await audit.list({})

      expect(events).toEqual([event])
    })

    it('2. drops disallowed keys (e.g. accessToken, password)', async () => {
      const audit = createOwnMobileRelayAuditMemory()
      await audit.append({
        at: 1700000000100,
        type: 'auth.attempt',
        fields: {
          actor: 'device-client',
          accessToken: 'sensitive-token',
          password: 'plain-password',
          hostControlLive: false
        } as unknown as Record<string, string | number | boolean | null>
      })

      const events = await audit.list({})
      expect(events).toHaveLength(1)
      expect(events[0]).toEqual({
        at: 1700000000100,
        type: 'auth.attempt',
        fields: {
          actor: 'device-client',
          hostControlLive: false
        }
      })
    })

    it('3. bound: 10001st append drops oldest', async () => {
      const audit = createOwnMobileRelayAuditMemory()
      for (let i = 0; i <= MAX_AUDIT_EVENTS; i++) {
        await audit.append({
          at: 1700000000000 + i,
          type: 'event.tick',
          fields: {
            count: i
          }
        })
      }

      const total = await audit.list({ limit: 20000 })
      expect(total).toHaveLength(MAX_AUDIT_EVENTS)
      // Oldest (index 0, count: 0) must be dropped, index 1 (count: 1) is now the first
      expect(total[0]?.fields.count).toBe(1)
      expect(total.at(-1)?.fields.count).toBe(MAX_AUDIT_EVENTS)
    })

    it('4. list filters by type and since', async () => {
      const audit = createOwnMobileRelayAuditMemory()
      await audit.append({
        at: 100,
        type: 'session.connect',
        fields: { sessionId: 's1' }
      })
      await audit.append({
        at: 200,
        type: 'session.disconnect',
        fields: { sessionId: 's1', closeCode: 1000 }
      })
      await audit.append({
        at: 300,
        type: 'session.connect',
        fields: { sessionId: 's2' }
      })
      await audit.append({
        at: 400,
        type: 'session.disconnect',
        fields: { sessionId: 's2', closeCode: 1001 }
      })

      // filter by type
      const connectEvents = await audit.list({ type: 'session.connect' })
      expect(connectEvents).toHaveLength(2)
      expect(connectEvents.map((e) => e.at)).toEqual([100, 300])

      // filter by since (>= since)
      const sinceEvents = await audit.list({ since: 250 })
      expect(sinceEvents).toHaveLength(2)
      expect(sinceEvents.map((e) => e.at)).toEqual([300, 400])

      // filter by type + since + limit
      const combined = await audit.list({
        type: 'session.connect',
        since: 100,
        limit: 1
      })
      expect(combined).toHaveLength(1)
      expect(combined[0]?.at).toBe(100)
    })
  })
})
