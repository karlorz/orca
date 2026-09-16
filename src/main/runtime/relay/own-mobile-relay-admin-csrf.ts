import type { IncomingMessage } from 'node:http'

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value
  if (typeof raw !== 'string') {
    return undefined
  }
  const trimmed = raw.trim()
  return trimmed || undefined
}

export function canonicalizeOrigin(value: string): string {
  return value.trim().replace(/\/+$/, '')
}

export function originHeader(request: IncomingMessage): string | undefined {
  const origin = firstHeaderValue(request.headers.origin)
  if (!origin || origin === 'null') {
    return undefined
  }
  return canonicalizeOrigin(origin)
}

export function isAdminCsrfAllowed(request: IncomingMessage, authOrigin: string): boolean {
  const allowed = canonicalizeOrigin(authOrigin)
  const origin = originHeader(request)
  if (origin) {
    return origin === allowed
  }
  const fetchSite = firstHeaderValue(request.headers['sec-fetch-site'])
  if (fetchSite === 'same-origin') {
    return true
  }
  const referer = firstHeaderValue(request.headers.referer)
  if (!referer) {
    return false
  }
  try {
    return canonicalizeOrigin(new URL(referer).origin) === allowed
  } catch {
    return false
  }
}
