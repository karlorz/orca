import type { DatabaseSync } from 'node:sqlite'
import {
  MAX_AUDIT_EVENTS,
  sanitizeAuditFields,
  type OwnMobileRelayAuditEvent,
  type OwnMobileRelayAuditListOptions,
  type OwnMobileRelayAuditLog
} from './own-mobile-relay-audit'
import type { OwnMobileRelaySecurityState } from './own-mobile-relay-security-state'
import type { SqliteDbContext } from './own-mobile-relay-security-state-sqlite'

type SqliteAuditEventRow = {
  id: number
  at: number
  type: string
  fields_json: string
}

export function executeAppendAuditEventSqlite(
  db: DatabaseSync,
  event: OwnMobileRelayAuditEvent,
  maxEvents: number = MAX_AUDIT_EVENTS
): void {
  const sanitized = sanitizeAuditFields(event.fields)
  const fieldsJson = JSON.stringify(sanitized)

  db.exec('BEGIN IMMEDIATE;')
  try {
    db.prepare(`
      INSERT INTO audit_events (at, type, fields_json)
      VALUES (?, ?, ?)
    `).run(event.at, event.type, fieldsJson)

    db.prepare(`
      DELETE FROM audit_events
      WHERE id IN (
        SELECT id FROM audit_events
        ORDER BY at DESC, id DESC
        LIMIT -1 OFFSET ?
      )
    `).run(maxEvents)

    db.exec('COMMIT;')
  } catch (err) {
    db.exec('ROLLBACK;')
    throw err
  }
}

export function executeListAuditEventsSqlite(
  db: DatabaseSync,
  options: OwnMobileRelayAuditListOptions = {}
): OwnMobileRelayAuditEvent[] {
  const { since, type, limit, order = 'asc' } = options

  const conditions: string[] = []
  const params: (number | string)[] = []

  if (since !== undefined && !Number.isNaN(since)) {
    conditions.push('at >= ?')
    params.push(since)
  }

  if (type !== undefined) {
    conditions.push('type = ?')
    params.push(type)
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const orderClause = order === 'desc' ? 'ORDER BY at DESC, id DESC' : 'ORDER BY at ASC, id ASC'
  const limitClause = limit !== undefined && limit >= 0 ? `LIMIT ${limit}` : ''

  const sql = `
    SELECT id, at, type, fields_json
    FROM audit_events
    ${whereClause}
    ${orderClause}
    ${limitClause}
  `

  const rows = db.prepare(sql).all(...params) as SqliteAuditEventRow[]

  return rows.map((row) => {
    let fields: Record<string, string | number | boolean | null> = {}
    try {
      fields = JSON.parse(row.fields_json)
    } catch {
      fields = {}
    }
    return {
      at: Number(row.at),
      type: row.type,
      fields
    }
  })
}

export function createOwnMobileRelayAuditSqlite(
  securityState: OwnMobileRelaySecurityState,
  maxEvents: number = MAX_AUDIT_EVENTS
): OwnMobileRelayAuditLog {
  const stateWithCtx = securityState as unknown as { _sqliteCtx?: SqliteDbContext }
  const ctx = stateWithCtx._sqliteCtx

  if (!ctx) {
    throw new Error('createOwnMobileRelayAuditSqlite requires a SQLite security state adapter')
  }

  function assertOpen(): void {
    if (ctx?.isClosed) {
      throw new Error('Security state adapter is closed')
    }
  }

  return {
    async append(event: OwnMobileRelayAuditEvent): Promise<void> {
      assertOpen()
      executeAppendAuditEventSqlite(ctx!.db, event, maxEvents)
    },

    async list(options: OwnMobileRelayAuditListOptions = {}): Promise<OwnMobileRelayAuditEvent[]> {
      assertOpen()
      return executeListAuditEventsSqlite(ctx!.db, options)
    }
  }
}
