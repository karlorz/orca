import { chmodSync, existsSync, openSync, closeSync } from 'node:fs'
import type { DatabaseSync } from 'node:sqlite'
import type { OwnMobileRelaySecurityState } from './own-mobile-relay-security-state'
import {
  openOwnMobileRelaySecurityStateSqliteInternal,
  type SqliteSecurityInternalHooks,
  type SqliteSecurityStateOptions
} from './own-mobile-relay-security-state-sqlite'

export type { SqliteSecurityInternalHooks }

export function openOwnMobileRelaySecurityStateSqliteForTest(
  options: SqliteSecurityStateOptions,
  hooks?: SqliteSecurityInternalHooks
): {
  state: OwnMobileRelaySecurityState
  dbInstance: () => DatabaseSync | null
} {
  let capturedDb: DatabaseSync | null = null

  const internalHooks: SqliteSecurityInternalHooks = {
    ...hooks,
    onDbHandle: (db: DatabaseSync) => {
      capturedDb = db
      hooks?.onDbHandle?.(db)
    }
  }

  const state = openOwnMobileRelaySecurityStateSqliteInternal(options, internalHooks)
  return {
    state,
    dbInstance: () => capturedDb
  }
}

export function makeInsecureWalSidecar(walPath: string): void {
  if (!existsSync(walPath)) {
    const fd = openSync(walPath, 'w', 0o644)
    closeSync(fd)
  }
  chmodSync(walPath, 0o644)
}
