import { createServer, type Server } from 'node:http'
import { createServer as createNetServer } from 'node:net'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { generateKeyPair, SignJWT } from 'jose'
import { afterEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { RelayAssignmentStore } from './assignment-store.js'
import { reconcileCellAdmissionAtStartup } from './cell-admission-startup.js'
import { loadRelayConfig } from './config.js'
import { openRelayDatabase, type RelayDatabase } from './database.js'
import { createRelayServer } from './relay-server.js'

async function unusedPort(): Promise<number> {
  const server = createNetServer()
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen))
  const address = server.address() as AddressInfo
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()))
  return address.port
}

function combinedEnv(input: {
  port: number
  jwksUrl: string
  adminJwksUrl: string
  dataDir: string
}): NodeJS.ProcessEnv {
  return {
    PORT: String(input.port),
    ORCA_RELAY_PUBLIC_URL: 'http://127.0.0.1',
    ORCA_RELAY_CELL_URL: 'http://127.0.0.1',
    ORCA_RELAY_AUTH_ISSUER: 'http://127.0.0.1',
    ORCA_RELAY_JWKS_URL: input.jwksUrl,
    ORCA_RELAY_ASSIGNMENT_SIGNING_KEY: 'combined-boot-key-with-at-least-32-bytes',
    ORCA_RELAY_ADMIN_AUDIENCE: 'https://admin.example.invalid/v1/admin',
    ORCA_RELAY_DEPLOY_SERVICE_ACCOUNT: 'deploy@example.invalid',
    ORCA_RELAY_ADMIN_JWKS_URL: input.adminJwksUrl,
    ORCA_RELAY_DATA_DIR: input.dataDir
  }
}

describe('combined relay boot with dummy admin identity', () => {
  const cleanup: Array<() => Promise<void> | void> = []
  afterEach(async () => {
    while (cleanup.length > 0) await cleanup.pop()?.()
  })

  it('boots to a listening server without admin drain, gating readiness on JWKS and SQLite', async () => {
    let jwksHealthy = false
    const jwksServer = createServer((_request, response) => {
      if (!jwksHealthy) {
        response.writeHead(503).end()
        return
      }
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ keys: [] }))
    })
    await new Promise<void>((resolveListen) => jwksServer.listen(0, '127.0.0.1', resolveListen))
    cleanup.push(() => new Promise<void>((r) => jwksServer.close(() => r())))
    const jwksPort = (jwksServer.address() as AddressInfo).port

    let adminJwksRequests = 0
    const adminJwksServer = createServer((_request, response) => {
      adminJwksRequests += 1
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ keys: [] }))
    })
    await new Promise<void>((resolveListen) =>
      adminJwksServer.listen(0, '127.0.0.1', resolveListen)
    )
    cleanup.push(() => new Promise<void>((r) => adminJwksServer.close(() => r())))
    const adminJwksPort = (adminJwksServer.address() as AddressInfo).port

    const dataDir = mkdtempSync(join(tmpdir(), 'orca-relay-combined-boot-'))
    cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }))
    const port = await unusedPort()
    const config = loadRelayConfig(
      combinedEnv({
        port,
        jwksUrl: `http://127.0.0.1:${jwksPort}/jwks`,
        adminJwksUrl: `http://127.0.0.1:${adminJwksPort}/jwks`,
        dataDir
      })
    )
    expect(config).toMatchObject({
      role: 'combined',
      databaseUrl: undefined,
      adminAudience: 'https://admin.example.invalid/v1/admin',
      deployServiceAccount: 'deploy@example.invalid'
    })

    // Boot path mirrors src/index.ts minus the periodic timers.
    const database = await openRelayDatabase({ dataDir: config.dataDir })
    cleanup.push(() => database.close())
    expect(existsSync(join(dataDir, 'orca-relay.sqlite'))).toBe(true)
    await reconcileCellAdmissionAtStartup(config, new RelayAssignmentStore(database))

    // Readiness probes are cached 10s per server instance, so each dependency
    // state gets its own instance; only one needs to listen.
    const down = createRelayServer(config, database)
    expect(await down.ready()).toBe(false)

    jwksHealthy = true
    const up = createRelayServer(config, database)
    await new Promise<void>((resolveListen) =>
      up.server.listen(config.port, '127.0.0.1', resolveListen)
    )
    cleanup.push(
      () => new Promise<void>((resolveClose) => up.server.close(() => resolveClose()))
    )

    const origin = `http://127.0.0.1:${config.port}`
    const readyResponse = await fetch(`${origin}/ready`)
    expect(readyResponse.status).toBe(200)
    await expect(readyResponse.json()).resolves.toEqual({ ok: true })
    expect(await (await fetch(`${origin}/health`)).status).toBe(200)

    // Boot, readiness, and liveness never consulted the admin identity.
    expect(adminJwksRequests).toBe(0)

    const sqlDown: RelayDatabase = {
      query: async () => {
        throw new Error('sql down')
      },
      queryLocked: (sql, params) => database.queryLocked(sql, params),
      transaction: (operation) => database.transaction(operation),
      close: () => database.close()
    }
    const sqlDownServer = createRelayServer(config, sqlDown)
    expect(await sqlDownServer.ready()).toBe(false)

    // The admin plane stays request-driven: a well-formed but foreign token
    // reaches the admin JWKS lazily and is still rejected.
    const foreignKeys = await generateKeyPair('RS256')
    const foreignAdminToken = await new SignJWT({
      email: 'deploy@example.invalid',
      email_verified: true
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'foreign-admin-key' })
      .setIssuer('https://accounts.google.com')
      .setAudience('https://admin.example.invalid/v1/admin')
      .setSubject('foreign-subject')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(foreignKeys.privateKey)
    const drainResponse = await fetch(`${origin}/v1/admin/drain`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${foreignAdminToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ graceMs: 0 })
    })
    expect(drainResponse.status).toBe(401)
    expect(adminJwksRequests).toBe(1)

    // Host-control plane is up but gated on the relay token.
    const controlSocket = new WebSocket(`ws://127.0.0.1:${config.port}/v1/host/control`)
    const controlStatus = await new Promise<number>((resolveStatus) => {
      controlSocket.once('unexpected-response', (_request, response) =>
        resolveStatus(response.statusCode ?? 0)
      )
      controlSocket.once('error', () => resolveStatus(0))
    })
    expect(controlStatus).toBe(401)
  })
})
