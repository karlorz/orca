import { describe, expect, it, vi } from 'vitest'
import type { WebSocket } from 'ws'
import nacl from 'tweetnacl'
import { deriveRelayHostId } from './relay-http-client'
import { listenOwnMobileRelay } from './own-mobile-relay-http'
import { RelayControlClient } from './relay-control-client'
import { loginAndObtainSessionToken, TEST_OPERATOR } from './own-mobile-relay-test-auth'
import { createOwnMobileRelayAuditMemory } from './own-mobile-relay-audit-memory'
import type { E2EEKeypair } from '../e2ee-keypair'

function httpRequest(options: {
  port: number
  path: string
  method?: string
  headers?: Record<string, string>
  body?: string
}): Promise<{
  status: number
  headers: Record<string, string | string[] | undefined>
  text: () => Promise<string>
}> {
  return new Promise((resolve, reject) => {
    const http = require('node:http')
    const headers = { ...options.headers }
    if (options.body && !headers['content-length']) {
      headers['content-length'] = String(Buffer.byteLength(options.body))
    }
    const req = http.request(
      {
        host: '127.0.0.1',
        port: options.port,
        path: options.path,
        method: options.method ?? 'GET',
        headers
      },
      (res: {
        statusCode?: number
        headers: Record<string, string | string[] | undefined>
        on: (event: string, cb: (c?: Buffer) => void) => void
      }) => {
        const chunks: Buffer[] = []
        res.on('data', (c) => {
          if (c) {
            chunks.push(c)
          }
        })
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8')
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            text: async () => raw
          })
        })
      }
    )
    req.on('error', reject)
    if (options.body) {
      req.write(options.body)
    }
    req.end()
  })
}

function cookieFromSetCookie(setCookie: string | string[] | undefined): string {
  const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie
  if (!raw) {
    return ''
  }
  return raw.split(';')[0] ?? ''
}

describe('OwnMobileRelay Audit Emission Slice 5', () => {
  it('1. Phone connect when host is offline -> audit event phone.connect.rejected (closeCode: 4404, reason: host_not_found)', async () => {
    const auditLog = createOwnMobileRelayAuditMemory()
    const server = await listenOwnMobileRelay({
      operator: TEST_OPERATOR,
      origin: 'http://127.0.0.1',
      auditLog
    })

    try {
      const { WebSocket } = await import('ws')
      const wsUrl = `${server.origin.replace(/^http/, 'ws')}/v1/connect/offline-host-123`
      const ws = new WebSocket(wsUrl)

      const closeEvent = await new Promise<{ code: number; reason: string }>((resolve) => {
        ws.on('close', (code, reason) => resolve({ code, reason: reason.toString() }))
      })
      expect(closeEvent.code).toBe(4404)

      const events = await auditLog.list({ type: 'phone.connect.rejected' })
      expect(events.length).toBe(1)
      expect(events[0]).toMatchObject({
        type: 'phone.connect.rejected',
        fields: {
          relayHostId: 'offline-host-123',
          closeCode: 4404,
          reason: 'host_not_found'
        }
      })
    } finally {
      await server.close()
    }
  })

  it('2. Host-control reaching active -> host.control.up and 3. close that removes live registration -> host.control.down', async () => {
    const auditLog = createOwnMobileRelayAuditMemory()
    const hostKeys = nacl.box.keyPair()
    const keypair: E2EEKeypair = {
      publicKey: hostKeys.publicKey,
      secretKey: hostKeys.secretKey,
      publicKeyB64: Buffer.from(hostKeys.publicKey).toString('base64')
    }
    const relayHostId = deriveRelayHostId(hostKeys.publicKey)
    const identity = {
      userId: TEST_OPERATOR.userId,
      profileId: TEST_OPERATOR.profileId,
      organizationId: TEST_OPERATOR.organizationId
    }

    const server = await listenOwnMobileRelay({
      operator: TEST_OPERATOR,
      origin: 'http://127.0.0.1',
      auditLog
    })

    try {
      const sessionToken = await loginAndObtainSessionToken(server.origin)
      const tokenRes = await fetch(`${server.origin}/v1/desktop/auth/relay-token`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${sessionToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          relayHostId,
          hostPublicKeyB64: keypair.publicKeyB64
        })
      })
      const { relayToken } = (await tokenRes.json()) as { relayToken: string }

      const client = new RelayControlClient({
        cellUrl: server.origin,
        relayJwt: relayToken,
        relayHostId,
        assignmentEpoch: 1,
        identity,
        keypair,
        appVersion: '0.0.0-test',
        onConnectionOpen: vi.fn(),
        onDrain: vi.fn(),
        onClose: vi.fn()
      })

      await client.connect()
      expect(client.isLive()).toBe(true)

      const upEvents = await auditLog.list({ type: 'host.control.up' })
      expect(upEvents.length).toBe(1)
      expect(upEvents[0]).toMatchObject({
        type: 'host.control.up',
        fields: {
          relayHostId,
          hostControlLive: true
        }
      })

      // Now close client
      client.closeNow()
      await new Promise((resolve) => setTimeout(resolve, 50))

      const downEvents = await auditLog.list({ type: 'host.control.down' })
      expect(downEvents.length).toBe(1)
      expect(downEvents[0]).toMatchObject({
        type: 'host.control.down',
        fields: {
          relayHostId,
          hostControlLive: false
        }
      })
    } finally {
      await server.close()
    }
  })

  it('owner edge: replacement active control does not emit duplicate up, retired close does not emit down, current owner close emits down with code/reason', async () => {
    const auditLog = createOwnMobileRelayAuditMemory()
    const hostKeys = nacl.box.keyPair()
    const keypair: E2EEKeypair = {
      publicKey: hostKeys.publicKey,
      secretKey: hostKeys.secretKey,
      publicKeyB64: Buffer.from(hostKeys.publicKey).toString('base64')
    }
    const relayHostId = deriveRelayHostId(hostKeys.publicKey)
    const identity = {
      userId: TEST_OPERATOR.userId,
      profileId: TEST_OPERATOR.profileId,
      organizationId: TEST_OPERATOR.organizationId
    }

    const server = await listenOwnMobileRelay({
      operator: TEST_OPERATOR,
      origin: 'http://127.0.0.1',
      auditLog
    })

    try {
      const sessionToken = await loginAndObtainSessionToken(server.origin)
      const tokenRes = await fetch(`${server.origin}/v1/desktop/auth/relay-token`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${sessionToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          relayHostId,
          hostPublicKeyB64: keypair.publicKeyB64
        })
      })
      const { relayToken } = (await tokenRes.json()) as { relayToken: string }

      const client1 = new RelayControlClient({
        cellUrl: server.origin,
        relayJwt: relayToken,
        relayHostId,
        assignmentEpoch: 1,
        identity,
        keypair,
        appVersion: '0.0.0-test',
        onConnectionOpen: vi.fn(),
        onDrain: vi.fn(),
        onClose: vi.fn()
      })

      await client1.connect()
      expect(client1.isLive()).toBe(true)

      const upEvents1 = await auditLog.list({ type: 'host.control.up' })
      expect(upEvents1.length).toBe(1)

      // Connect client2 (simulating replacement control on rebind/reconnect for same host)
      const client2 = new RelayControlClient({
        cellUrl: server.origin,
        relayJwt: relayToken,
        relayHostId,
        assignmentEpoch: 1,
        identity,
        keypair,
        appVersion: '0.0.0-test',
        onConnectionOpen: vi.fn(),
        onDrain: vi.fn(),
        onClose: vi.fn()
      })

      await client2.connect()
      expect(client2.isLive()).toBe(true)

      // Host was already up, replacement active control must not emit another host.control.up
      const upEvents2 = await auditLog.list({ type: 'host.control.up' })
      expect(upEvents2.length).toBe(1)

      // Close client1 (retired predecessor). It should NOT emit host.control.down since client2 is current owner
      client1.closeNow()
      await new Promise((resolve) => setTimeout(resolve, 50))

      const downEvents1 = await auditLog.list({ type: 'host.control.down' })
      expect(downEvents1.length).toBe(0)

      // Close client2 with specific code/reason or normal close.
      client2.closeNow()
      await new Promise((resolve) => setTimeout(resolve, 50))

      const downEvents2 = await auditLog.list({ type: 'host.control.down' })
      expect(downEvents2.length).toBe(1)
      expect(downEvents2[0]).toMatchObject({
        type: 'host.control.down',
        fields: {
          relayHostId,
          hostControlLive: false
        }
      })
    } finally {
      await server.close()
    }
  })

  it('captures peer websocket close code and reason in host.control.down audit event', async () => {
    const auditLog = createOwnMobileRelayAuditMemory()
    const hostKeys = nacl.box.keyPair()
    const keypair: E2EEKeypair = {
      publicKey: hostKeys.publicKey,
      secretKey: hostKeys.secretKey,
      publicKeyB64: Buffer.from(hostKeys.publicKey).toString('base64')
    }
    const relayHostId = deriveRelayHostId(hostKeys.publicKey)
    const identity = {
      userId: TEST_OPERATOR.userId,
      profileId: TEST_OPERATOR.profileId,
      organizationId: TEST_OPERATOR.organizationId
    }

    const server = await listenOwnMobileRelay({
      operator: TEST_OPERATOR,
      origin: 'http://127.0.0.1',
      auditLog
    })

    try {
      const sessionToken = await loginAndObtainSessionToken(server.origin)
      const tokenRes = await fetch(`${server.origin}/v1/desktop/auth/relay-token`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${sessionToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          relayHostId,
          hostPublicKeyB64: keypair.publicKeyB64
        })
      })
      const { relayToken } = (await tokenRes.json()) as { relayToken: string }

      const client = new RelayControlClient({
        cellUrl: server.origin,
        relayJwt: relayToken,
        relayHostId,
        assignmentEpoch: 1,
        identity,
        keypair,
        appVersion: '0.0.0-test',
        onConnectionOpen: vi.fn(),
        onDrain: vi.fn(),
        onClose: vi.fn()
      })

      await client.connect()

      // Send raw client close with specific code 4000 and reason 'client_restarting'
      // Access underlying socket to close with custom code/reason
      const clientSocket = (client as unknown as { socket: WebSocket }).socket
      clientSocket.close(4000, 'client_restarting')

      await new Promise((resolve) => setTimeout(resolve, 50))

      const downEvents = await auditLog.list({ type: 'host.control.down' })
      expect(downEvents.length).toBe(1)
      expect(downEvents[0]).toMatchObject({
        type: 'host.control.down',
        fields: {
          relayHostId,
          closeCode: 4000,
          reason: 'client_restarting',
          hostControlLive: false
        }
      })
    } finally {
      await server.close()
    }
  })

  it('4. Admin HTML POST revoke of a device -> device.revoked (actor: operator)', async () => {
    const auditLog = createOwnMobileRelayAuditMemory()
    const server = await listenOwnMobileRelay({
      operator: TEST_OPERATOR,
      origin: 'http://127.0.0.1',
      auditLog
    })

    try {
      const login = await httpRequest({
        port: server.boundPort,
        path: '/admin/login',
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          origin: 'http://127.0.0.1'
        },
        body: new URLSearchParams({
          email: TEST_OPERATOR.email,
          password: TEST_OPERATOR.password
        }).toString()
      })
      const cookie = cookieFromSetCookie(login.headers['set-cookie'])

      const ok = await httpRequest({
        port: server.boundPort,
        path: '/admin/pairing/devices/host-abc/dev-xyz/revoke',
        method: 'POST',
        headers: {
          cookie,
          origin: 'http://127.0.0.1',
          'content-type': 'application/x-www-form-urlencoded'
        }
      })
      expect(ok.status).toBe(303)

      const events = await auditLog.list({ type: 'device.revoked' })
      expect(events.length).toBe(1)
      expect(events[0]).toMatchObject({
        type: 'device.revoked',
        fields: {
          relayHostId: 'host-abc',
          deviceId: 'dev-xyz',
          actor: 'operator'
        }
      })
    } finally {
      await server.close()
    }
  })

  it('5. device-revoke control message from desktop -> device.revoked (actor: host)', async () => {
    const auditLog = createOwnMobileRelayAuditMemory()
    const hostKeys = nacl.box.keyPair()
    const keypair: E2EEKeypair = {
      publicKey: hostKeys.publicKey,
      secretKey: hostKeys.secretKey,
      publicKeyB64: Buffer.from(hostKeys.publicKey).toString('base64')
    }
    const relayHostId = deriveRelayHostId(hostKeys.publicKey)
    const identity = {
      userId: TEST_OPERATOR.userId,
      profileId: TEST_OPERATOR.profileId,
      organizationId: TEST_OPERATOR.organizationId
    }

    const server = await listenOwnMobileRelay({
      operator: TEST_OPERATOR,
      origin: 'http://127.0.0.1',
      auditLog
    })

    try {
      const sessionToken = await loginAndObtainSessionToken(server.origin)
      const tokenRes = await fetch(`${server.origin}/v1/desktop/auth/relay-token`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${sessionToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          relayHostId,
          hostPublicKeyB64: keypair.publicKeyB64
        })
      })
      const { relayToken } = (await tokenRes.json()) as { relayToken: string }

      const client = new RelayControlClient({
        cellUrl: server.origin,
        relayJwt: relayToken,
        relayHostId,
        assignmentEpoch: 1,
        identity,
        keypair,
        appVersion: '0.0.0-test',
        onConnectionOpen: vi.fn(),
        onDrain: vi.fn(),
        onClose: vi.fn()
      })

      await client.connect()
      expect(client.isLive()).toBe(true)

      await client.revokeDevice('device-to-revoke-xyz')

      const events = await auditLog.list({ type: 'device.revoked' })
      expect(events.length).toBe(1)
      expect(events[0]).toMatchObject({
        type: 'device.revoked',
        fields: {
          relayHostId,
          deviceId: 'device-to-revoke-xyz',
          actor: 'host'
        }
      })

      client.closeNow()
    } finally {
      await server.close()
    }
  })
})
