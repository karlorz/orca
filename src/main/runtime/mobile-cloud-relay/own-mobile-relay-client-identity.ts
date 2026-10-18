import type { IncomingMessage } from 'node:http'

/**
 * Client identity for throttle and auth. Own-mobile Relay sits on a public
 * listener, so X-Forwarded-For and X-Real-IP are attacker-controlled.
 */
export function clientIdentityAddress(
  request: Pick<IncomingMessage, 'headers' | 'socket'>
): string | undefined {
  return request.socket?.remoteAddress
}
