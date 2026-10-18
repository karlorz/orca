import { createHash } from 'node:crypto'
import type { ServerResponse } from 'node:http'
import type { OwnMobileRelaySecurityState } from './own-mobile-relay-security-state'

export async function handleResolvePost(
  record: unknown,
  advertisedOrigin: string,
  securityState: OwnMobileRelaySecurityState,
  response: ServerResponse
): Promise<void> {
  const req = record as { v?: unknown; relayHostId?: unknown; resumeToken?: unknown }
  if (
    !req ||
    req.v !== 1 ||
    typeof req.relayHostId !== 'string' ||
    typeof req.resumeToken !== 'string'
  ) {
    const payload = Buffer.from(JSON.stringify({ error: 'invalid_request' }))
    response.writeHead(400, {
      'content-type': 'application/json',
      'content-length': payload.byteLength
    })
    response.end(payload)
    return
  }

  const tokenHash = createHash('sha256').update(req.resumeToken).digest('base64url')
  const match = await securityState.matchDeviceCredential(req.relayHostId, tokenHash)

  if (!match) {
    const payload = Buffer.from(JSON.stringify({ error: 'unauthorized' }))
    response.writeHead(401, {
      'content-type': 'application/json',
      'content-length': payload.byteLength
    })
    response.end(payload)
    return
  }

  const payload = Buffer.from(
    JSON.stringify({
      v: 1,
      cellUrl: advertisedOrigin,
      assignmentEpoch: 1,
      leaseExpiresAt: Date.now() + 60_000
    })
  )
  response.writeHead(200, {
    'content-type': 'application/json',
    'content-length': payload.byteLength
  })
  response.end(payload)
}
