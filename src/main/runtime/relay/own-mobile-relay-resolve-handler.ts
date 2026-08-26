import { createHash } from 'node:crypto'
import type { ServerResponse } from 'node:http'
import type { OwnMobileRelayRouter } from './own-mobile-relay-splice-handler'

export function handleResolvePost(
  record: unknown,
  advertisedOrigin: string,
  router: OwnMobileRelayRouter,
  response: ServerResponse
): void {
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
  const now = Date.now()
  let matched = false

  for (const cred of router.deviceCredentials.values()) {
    if (cred.relayHostId === req.relayHostId) {
      if (cred.currentResumeTokenHash === tokenHash && cred.resumeExpiresAt > now) {
        matched = true
        break
      }
      if (
        cred.graceResumeTokenHash === tokenHash &&
        cred.graceExpiresAt !== undefined &&
        cred.graceExpiresAt > now
      ) {
        matched = true
        break
      }
    }
  }

  if (!matched) {
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
