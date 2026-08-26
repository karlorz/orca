import { randomBytes } from 'node:crypto'
import type {
  SecurityStateRelayGrant,
  SecurityStateIssueRelayGrantInput,
  SecurityStateIssuedRelayGrant
} from './own-mobile-relay-security-state'
import { sha256Base64Url } from './own-mobile-relay-security-state-device-cleanup'

export type SqliteGrantRow = {
  grant_id: string
  account_id: string
  parent_session_id: string
  relay_token_hash: string
  relay_host_id: string
  host_public_key_b64: string
  auth_epoch: number
  expires_at: number
  created_at: number
  revoked_at: number | null
  user_id: string
  profile_id: string
  organization_id: string
}

export function executeIssueRelayGrantSqlite(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  input: SecurityStateIssueRelayGrantInput,
  now: number
): SecurityStateIssuedRelayGrant | null {
  db.exec('BEGIN IMMEDIATE;')
  try {
    const acc = db
      .prepare('SELECT account_id, auth_epoch FROM operator_account WHERE singleton_id = 1')
      .get() as { account_id: string; auth_epoch: number } | undefined
    if (!acc) {
      db.exec('ROLLBACK;')
      return null
    }

    const parent = db
      .prepare(`
        SELECT session_id FROM access_sessions
        WHERE session_id = ?
          AND revoked_at IS NULL
          AND expires_at > ?
          AND auth_epoch = ?
      `)
      .get(input.parentSessionId, now, acc.auth_epoch)
    if (!parent) {
      db.exec('ROLLBACK;')
      return null
    }

    const grantId = randomBytes(16).toString('base64url')
    const relayTokenHash = sha256Base64Url(input.rawRelayToken)
    const expiresAt = now + input.ttlMs

    db.prepare(`
      INSERT INTO relay_grants (
        grant_id, account_id, parent_session_id, relay_token_hash,
        relay_host_id, host_public_key_b64, auth_epoch, expires_at,
        created_at, revoked_at, user_id, profile_id, organization_id
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?
      )
    `).run(
      grantId,
      acc.account_id,
      input.parentSessionId,
      relayTokenHash,
      input.relayHostId,
      input.hostPublicKeyB64,
      acc.auth_epoch,
      expiresAt,
      now,
      input.identity.userId,
      input.identity.profileId,
      input.identity.organizationId
    )

    db.exec('COMMIT;')
    return {
      grantId,
      relayHostId: input.relayHostId,
      hostPublicKeyB64: input.hostPublicKeyB64,
      expiresAt,
      identity: input.identity
    }
  } catch (err) {
    db.exec('ROLLBACK;')
    throw err
  }
}

export function executeValidateRelayGrantByTokenSqlite(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  rawRelayToken: string,
  now: number
): SecurityStateRelayGrant | null {
  const hash = sha256Base64Url(rawRelayToken)
  const row = db
    .prepare(`
      SELECT g.grant_id, g.account_id, g.parent_session_id, g.relay_host_id,
             g.host_public_key_b64, g.auth_epoch, g.expires_at, g.created_at,
             g.user_id, g.profile_id, g.organization_id
      FROM relay_grants g
      JOIN operator_account a ON a.singleton_id = 1 AND a.account_id = g.account_id
      JOIN access_sessions s ON s.session_id = g.parent_session_id
      WHERE g.relay_token_hash = ?
        AND g.revoked_at IS NULL
        AND g.expires_at > ?
        AND g.auth_epoch = a.auth_epoch
        AND s.revoked_at IS NULL
        AND s.expires_at > ?
        AND s.auth_epoch = a.auth_epoch
    `)
    .get(hash, now, now) as SqliteGrantRow | undefined

  if (!row) {
    return null
  }
  return {
    grantId: row.grant_id,
    accountId: row.account_id,
    parentSessionId: row.parent_session_id,
    relayHostId: row.relay_host_id,
    hostPublicKeyB64: row.host_public_key_b64,
    authEpoch: Number(row.auth_epoch),
    expiresAt: Number(row.expires_at),
    createdAt: Number(row.created_at),
    identity: {
      userId: row.user_id,
      profileId: row.profile_id,
      organizationId: row.organization_id
    }
  }
}

export function executeValidateRelayGrantByIdSqlite(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  grantId: string,
  relayHostId: string | undefined,
  now: number
): SecurityStateRelayGrant | null {
  const query = relayHostId
    ? `
      SELECT g.grant_id, g.account_id, g.parent_session_id, g.relay_host_id,
             g.host_public_key_b64, g.auth_epoch, g.expires_at, g.created_at,
             g.user_id, g.profile_id, g.organization_id
      FROM relay_grants g
      JOIN operator_account a ON a.singleton_id = 1 AND a.account_id = g.account_id
      JOIN access_sessions s ON s.session_id = g.parent_session_id
      WHERE g.grant_id = ?
        AND g.relay_host_id = ?
        AND g.revoked_at IS NULL
        AND g.expires_at > ?
        AND g.auth_epoch = a.auth_epoch
        AND s.revoked_at IS NULL
        AND s.expires_at > ?
        AND s.auth_epoch = a.auth_epoch
    `
    : `
      SELECT g.grant_id, g.account_id, g.parent_session_id, g.relay_host_id,
             g.host_public_key_b64, g.auth_epoch, g.expires_at, g.created_at,
             g.user_id, g.profile_id, g.organization_id
      FROM relay_grants g
      JOIN operator_account a ON a.singleton_id = 1 AND a.account_id = g.account_id
      JOIN access_sessions s ON s.session_id = g.parent_session_id
      WHERE g.grant_id = ?
        AND g.revoked_at IS NULL
        AND g.expires_at > ?
        AND g.auth_epoch = a.auth_epoch
        AND s.revoked_at IS NULL
        AND s.expires_at > ?
        AND s.auth_epoch = a.auth_epoch
    `
  const params = relayHostId ? [grantId, relayHostId, now, now] : [grantId, now, now]
  const row = db.prepare(query).get(...params) as SqliteGrantRow | undefined

  if (!row) {
    return null
  }
  return {
    grantId: row.grant_id,
    accountId: row.account_id,
    parentSessionId: row.parent_session_id,
    relayHostId: row.relay_host_id,
    hostPublicKeyB64: row.host_public_key_b64,
    authEpoch: Number(row.auth_epoch),
    expiresAt: Number(row.expires_at),
    createdAt: Number(row.created_at),
    identity: {
      userId: row.user_id,
      profileId: row.profile_id,
      organizationId: row.organization_id
    }
  }
}
