export type ProbeResult = {
  endpoint: string
  status: 'ok' | 'error'
  httpStatus: number | null
  latencyMs: number
  detail?: string
}

export type JwksProbeResult = ProbeResult & {
  keyCount?: number
  kids?: string[]
}

async function discardBody(response: Response | null): Promise<void> {
  try {
    await response?.body?.cancel()
  } catch {
    // already consumed or closed
  }
}

async function timedGet(
  url: string,
  fetchFn: typeof fetch,
  timeoutMs: number,
  accept: string
): Promise<{ result: ProbeResult; response: Response | null }> {
  const start = performance.now()
  try {
    const response = await fetchFn(url, {
      method: 'GET',
      headers: { Accept: accept },
      signal: AbortSignal.timeout(timeoutMs)
    })
    const latencyMs = Math.round(performance.now() - start)
    return {
      result: {
        endpoint: url,
        status: response.ok ? 'ok' : 'error',
        httpStatus: response.status,
        latencyMs,
        ...(response.ok ? {} : { detail: `HTTP ${response.status}: ${response.statusText}` })
      },
      response
    }
  } catch (err) {
    return {
      result: {
        endpoint: url,
        status: 'error',
        httpStatus: null,
        latencyMs: Math.round(performance.now() - start),
        detail: err instanceof Error ? err.message : String(err)
      },
      response: null
    }
  }
}

export async function probeHttp(
  url: string,
  fetchFn: typeof fetch = fetch,
  timeoutMs = 5000
): Promise<ProbeResult> {
  const { result, response } = await timedGet(url, fetchFn, timeoutMs, '*/*')
  await discardBody(response)
  return result
}

export async function probeJwks(
  url: string,
  fetchFn: typeof fetch = fetch,
  timeoutMs = 5000
): Promise<JwksProbeResult> {
  const { result, response } = await timedGet(url, fetchFn, timeoutMs, 'application/json')
  if (result.status !== 'ok' || response === null) {
    await discardBody(response)
    return result
  }

  try {
    const data: unknown = await response.json()
    const keys =
      typeof data === 'object' && data !== null && 'keys' in data && Array.isArray(data.keys)
        ? data.keys
        : null
    if (keys === null) {
      return {
        ...result,
        status: 'error',
        detail: 'Invalid JWKS payload: missing keys array'
      }
    }

    const kids: string[] = []
    for (const key of keys) {
      if (typeof key === 'object' && key !== null && 'kid' in key && typeof key.kid === 'string') {
        kids.push(key.kid)
      }
    }

    return {
      ...result,
      keyCount: keys.length,
      kids
    }
  } catch (err) {
    return {
      ...result,
      status: 'error',
      detail: err instanceof Error ? err.message : String(err)
    }
  }
}
