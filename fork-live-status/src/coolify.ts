export type CoolifyAppRecord = {
  uuid: string
  name: string
  status: string
  image: string | null
  error?: string
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(value: unknown, key: string): string | undefined {
  if (!isObject(value)) {
    return undefined
  }
  const field = value[key]
  return typeof field === 'string' && field.length > 0 ? field : undefined
}

function unwrapApplication(payload: unknown): unknown {
  if (!isObject(payload)) {
    return payload
  }
  const nested = payload.data
  return isObject(nested) ? nested : payload
}

function resolveImage(raw: unknown): string | null {
  return (
    readString(raw, 'docker_registry_image_name') ??
    readString(raw, 'docker_image') ??
    readString(raw, 'image') ??
    readString(raw, 'base_docker_image') ??
    null
  )
}

function failedRecord(uuid: string, error: string): CoolifyAppRecord {
  return { uuid, name: 'unknown', status: 'error', image: null, error }
}

export async function fetchCoolifyApp(
  apiUrl: string,
  token: string,
  uuid: string,
  fetchFn: typeof fetch = fetch
): Promise<CoolifyAppRecord> {
  const url = `${apiUrl.replace(/\/+$/, '')}/api/v1/applications/${uuid}`
  const headers = new Headers({ Accept: 'application/json' })
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  try {
    const res = await fetchFn(url, { headers, signal: AbortSignal.timeout(5000) })
    if (!res.ok) {
      try {
        await res.body?.cancel()
      } catch {
        // already consumed or closed
      }
      return failedRecord(uuid, `HTTP ${res.status}: ${res.statusText}`)
    }

    const payload: unknown = await res.json()
    const app = unwrapApplication(payload)
    return {
      uuid: readString(app, 'uuid') ?? uuid,
      name: readString(app, 'name') ?? 'unknown',
      status: readString(app, 'status') ?? 'unknown',
      image: resolveImage(app)
    }
  } catch (err) {
    return failedRecord(uuid, err instanceof Error ? err.message : String(err))
  }
}
