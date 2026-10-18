function firstHeader(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value
  if (typeof raw !== 'string') {
    return undefined
  }
  const trimmed = raw.trim()
  return !trimmed || trimmed.toLowerCase() === 'null' ? undefined : trimmed.replace(/\/$/, '')
}

function originFromUrl(url: string | undefined): string | undefined {
  if (!url) {
    return undefined
  }
  try {
    return new URL(url).origin
  } catch {
    return undefined
  }
}

function hostMatchesAllowed(
  hostHeader: string | string[] | undefined,
  allowedOrigins: string[]
): boolean {
  const host = firstHeader(hostHeader)
  if (!host) {
    return false
  }
  return allowedOrigins.some((origin) => {
    try {
      const allowed = new URL(origin)
      return allowed.host === host || allowed.hostname === host.split(':')[0]
    } catch {
      return false
    }
  })
}

/** A present Origin or Referer must match; only clients missing both may fall back to Host. */
export function isAllowedPasswordOrigin(
  originHeader: string | string[] | undefined,
  refererHeader: string | string[] | undefined,
  hostHeader: string | string[] | undefined,
  allowedOrigins: string[]
): boolean {
  const origin = firstHeader(originHeader)
  if (originHeader !== undefined) {
    return origin !== undefined && allowedOrigins.includes(origin)
  }
  const refererOrigin = originFromUrl(firstHeader(refererHeader))
  if (refererHeader !== undefined) {
    return refererOrigin !== undefined && allowedOrigins.includes(refererOrigin)
  }
  return hostMatchesAllowed(hostHeader, allowedOrigins)
}
