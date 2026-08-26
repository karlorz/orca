import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomBytes } from 'node:crypto'

export type OwnMobileRelayListenOptions = {
  operatorAccessToken: string
  origin: string
}

export type OwnMobileRelayServer = {
  origin: string
  close: () => Promise<void>
}

type IssuedRelayToken = {
  relayHostId: string
  hostPublicKeyB64: string
}

const RELAY_TOKEN_TTL_MS = 60 * 60 * 1000

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const payload = Buffer.from(JSON.stringify(body))
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': payload.byteLength
  })
  response.end(payload)
}

function bearerToken(header: string | undefined): string | null {
  if (!header?.startsWith('Bearer ')) {
    return null
  }
  const token = header.slice('Bearer '.length).trim()
  return token.length > 0 ? token : null
}

function readJsonBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk) => chunks.push(chunk as Buffer))
    request.on('end', () => {
      if (chunks.length === 0) {
        resolve(null)
        return
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown)
      } catch {
        reject(new Error('invalid_json'))
      }
    })
    request.on('error', reject)
  })
}

export function listenOwnMobileRelay(
  options: OwnMobileRelayListenOptions
): Promise<OwnMobileRelayServer> {
  const issued = new Map<string, IssuedRelayToken>()
  let advertisedOrigin = options.origin
  const server = createServer((request, response) => {
    void handleRequest(request, response)
  })

  async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (request.method === 'GET' && url.pathname === '/health') {
      sendJson(response, 200, { ok: true })
      return
    }
    if (request.method === 'POST' && url.pathname === '/v1/desktop/auth/relay-token') {
      const access = bearerToken(request.headers.authorization)
      if (access !== options.operatorAccessToken) {
        sendJson(response, 401, { error: 'unauthorized' })
        return
      }
      let body: unknown
      try {
        body = await readJsonBody(request)
      } catch {
        sendJson(response, 400, { error: 'invalid_json' })
        return
      }
      const record = body as { relayHostId?: unknown; hostPublicKeyB64?: unknown }
      if (typeof record.relayHostId !== 'string' || typeof record.hostPublicKeyB64 !== 'string') {
        sendJson(response, 400, { error: 'invalid_request' })
        return
      }
      const relayToken = randomBytes(32).toString('base64url')
      issued.set(relayToken, {
        relayHostId: record.relayHostId,
        hostPublicKeyB64: record.hostPublicKeyB64
      })
      sendJson(response, 200, {
        relayToken,
        expiresAt: Date.now() + RELAY_TOKEN_TTL_MS
      })
      return
    }
    if (request.method === 'POST' && url.pathname === '/v1/assign') {
      const relayToken = bearerToken(request.headers.authorization)
      const grant = relayToken ? issued.get(relayToken) : undefined
      if (!grant) {
        sendJson(response, 401, { error: 'unauthorized' })
        return
      }
      let body: unknown
      try {
        body = await readJsonBody(request)
      } catch {
        sendJson(response, 400, { error: 'invalid_json' })
        return
      }
      const record = body as { v?: unknown; relayHostId?: unknown }
      if (record.v !== 1 || record.relayHostId !== grant.relayHostId) {
        sendJson(response, 400, { error: 'invalid_request' })
        return
      }
      sendJson(response, 200, {
        v: 1,
        cellUrl: advertisedOrigin,
        assignmentEpoch: 1,
        lease: randomBytes(32).toString('base64url')
      })
      return
    }
    sendJson(response, 404, { error: 'not_found' })
  }

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close()
        reject(new Error('own_mobile_relay_bind_failed'))
        return
      }
      const advertised = new URL(options.origin)
      advertised.port = String(address.port)
      advertisedOrigin = advertised.origin
      resolve({
        origin: advertisedOrigin,
        close: () =>
          new Promise((closeResolve, closeReject) => {
            server.close((error) => (error ? closeReject(error) : closeResolve()))
          })
      })
    })
  })
}
