import { describe, expect, it, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { OwnMobileRelayAuditEvent } from './own-mobile-relay-audit'
import {
  openOwnMobileRelaySecurityStateSqlite,
  createOwnMobileRelayAuditSqlite
} from './own-mobile-relay-security-state-sqlite'

describe('own-mobile-relay-audit-sqlite', () => {
  let tempDirs: string[] = []

  async function createTempDbPath(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'orca-audit-sqlite-test-'))
    tempDirs.push(dir)
    return join(dir, 'security-state.db')
  }

  afterEach(async () => {
    for (const dir of tempDirs) {
      await rm(dir, { recursive: true, force: true }).catch(() => {})
    }
    tempDirs = []
  })

  it('1. append + list returns sanitized event with SQLite persistence', async () => {
    const dbPath = await createTempDbPath()
    const state = openOwnMobileRelaySecurityStateSqlite({ dbPath, testMode: true })
    const audit = createOwnMobileRelayAuditSqlite(state)

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

    await state.close()
  })

  it('2. drops disallowed keys and sensitive pattern matching keys before serialization', async () => {
    const dbPath = await createTempDbPath()
    const state = openOwnMobileRelaySecurityStateSqlite({ dbPath, testMode: true })
    const audit = createOwnMobileRelayAuditSqlite(state)

    await audit.append({
      at: 1700000000100,
      type: 'auth.attempt',
      fields: {
        actor: 'device-client',
        accessToken: 'sensitive-token',
        password: 'plain-password',
        rawSecret: 'top-secret',
        bearerToken: 'bearer-xyz',
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

    await state.close()
  })

  it('3. bound: 10001st append drops oldest row', async () => {
    const dbPath = await createTempDbPath()
    const state = openOwnMobileRelaySecurityStateSqlite({ dbPath, testMode: true })
    const audit = createOwnMobileRelayAuditSqlite(state, 5) // test with bound of 5

    for (let i = 0; i <= 5; i++) {
      await audit.append({
        at: 1700000000000 + i,
        type: 'event.tick',
        fields: {
          count: i
        }
      })
    }

    const total = await audit.list({ limit: 20 })
    expect(total).toHaveLength(5)
    // Oldest (count 0) dropped, count 1 is now oldest
    expect(total[0]?.fields.count).toBe(1)
    expect(total.at(-1)?.fields.count).toBe(5)

    await state.close()
  })

  it('4. list filters by type, since, limit, and order', async () => {
    const dbPath = await createTempDbPath()
    const state = openOwnMobileRelaySecurityStateSqlite({ dbPath, testMode: true })
    const audit = createOwnMobileRelayAuditSqlite(state)

    await audit.append({ at: 100, type: 'session.connect', fields: { sessionId: 's1' } })
    await audit.append({
      at: 200,
      type: 'session.disconnect',
      fields: { sessionId: 's1', closeCode: 1000 }
    })
    await audit.append({ at: 300, type: 'session.connect', fields: { sessionId: 's2' } })
    await audit.append({
      at: 400,
      type: 'session.disconnect',
      fields: { sessionId: 's2', closeCode: 1001 }
    })

    // default order asc
    const defaultAsc = await audit.list({})
    expect(defaultAsc.map((e) => e.at)).toEqual([100, 200, 300, 400])

    // explicit order desc
    const desc = await audit.list({ order: 'desc' })
    expect(desc.map((e) => e.at)).toEqual([400, 300, 200, 100])

    // filter by type
    const connectEvents = await audit.list({ type: 'session.connect' })
    expect(connectEvents.map((e) => e.at)).toEqual([100, 300])

    // filter by since
    const sinceEvents = await audit.list({ since: 250 })
    expect(sinceEvents.map((e) => e.at)).toEqual([300, 400])

    // order desc before limit
    const descLimited = await audit.list({ order: 'desc', limit: 2 })
    expect(descLimited.map((e) => e.at)).toEqual([400, 300])

    // filter by type + since + limit + desc
    const combined = await audit.list({
      type: 'session.disconnect',
      since: 150,
      limit: 1,
      order: 'desc'
    })
    expect(combined).toHaveLength(1)
    expect(combined[0]?.at).toBe(400)

    await state.close()
  })

  it('5. deterministic tie-breaking for equal timestamps', async () => {
    const dbPath = await createTempDbPath()
    const state = openOwnMobileRelaySecurityStateSqlite({ dbPath, testMode: true })
    const audit = createOwnMobileRelayAuditSqlite(state)

    await audit.append({ at: 500, type: 'ev', fields: { count: 1 } })
    await audit.append({ at: 500, type: 'ev', fields: { count: 2 } })
    await audit.append({ at: 500, type: 'ev', fields: { count: 3 } })

    const asc = await audit.list({ order: 'asc' })
    expect(asc.map((e) => e.fields.count)).toEqual([1, 2, 3])

    const desc = await audit.list({ order: 'desc' })
    expect(desc.map((e) => e.fields.count)).toEqual([3, 2, 1])

    await state.close()
  })

  it('6. persists events across close and reopen', async () => {
    const dbPath = await createTempDbPath()
    const state1 = openOwnMobileRelaySecurityStateSqlite({ dbPath, testMode: true })
    const audit1 = createOwnMobileRelayAuditSqlite(state1)

    await audit1.append({ at: 1000, type: 'persist.test', fields: { count: 42 } })
    await state1.close()

    // Reopen DB
    const state2 = openOwnMobileRelaySecurityStateSqlite({ dbPath, testMode: true })
    const audit2 = createOwnMobileRelayAuditSqlite(state2)

    const events = await audit2.list({})
    expect(events).toHaveLength(1)
    expect(events[0]?.type).toBe('persist.test')
    expect(events[0]?.fields.count).toBe(42)

    await state2.close()
  })

  it('7. handles shared database lifecycle without double-close hazard', async () => {
    const dbPath = await createTempDbPath()
    const state = openOwnMobileRelaySecurityStateSqlite({ dbPath, testMode: true })
    const audit = createOwnMobileRelayAuditSqlite(state)

    await audit.append({ at: 100, type: 'test', fields: {} })
    await state.close()

    // Calling audit on closed state fails gracefully
    await expect(audit.append({ at: 200, type: 'test', fields: {} })).rejects.toThrow(/closed/)
    await expect(audit.list({})).rejects.toThrow(/closed/)
  })
})
