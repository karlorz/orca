import type { IncomingMessage, ServerResponse } from 'node:http'

export class ReadBodyError extends Error {
  readonly code: 'payload_too_large' | 'malformed_encoding' | 'invalid_json'

  constructor(code: 'payload_too_large' | 'malformed_encoding' | 'invalid_json', message: string) {
    super(message)
    this.name = 'ReadBodyError'
    this.code = code
  }
}

export function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const payload = Buffer.from(JSON.stringify(body))
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': payload.byteLength
  })
  response.end(payload)
}

export function bearerToken(header: string | undefined): string | null {
  if (!header?.startsWith('Bearer ')) {
    return null
  }
  const token = header.slice('Bearer '.length).trim()
  return token.length > 0 ? token : null
}

export function readJsonBody(request: IncomingMessage): Promise<unknown> {
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
        reject(new ReadBodyError('invalid_json', 'Invalid JSON body'))
      }
    })
    request.on('error', reject)
  })
}

export const MAX_FORM_BODY_BYTES = 16 * 1024 // 16 KiB

export function readUrlEncodedBodySafely(
  request: IncomingMessage,
  maxBytes: number = MAX_FORM_BODY_BYTES
): Promise<URLSearchParams> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let receivedBytes = 0
    let rejected = false

    function onData(chunk: Buffer): void {
      if (rejected) {
        return
      }
      receivedBytes += chunk.length
      if (receivedBytes > maxBytes) {
        rejected = true
        if (typeof request.removeListener === 'function') {
          request.removeListener('data', onData)
          request.removeListener('end', onEnd)
        }
        reject(new ReadBodyError('payload_too_large', `Payload exceeded ${maxBytes} bytes`))
        return
      }
      chunks.push(chunk)
    }

    function onEnd(): void {
      if (rejected) {
        return
      }
      try {
        const text = Buffer.concat(chunks).toString('utf8')
        // Validate URL encoding decoding: decodeURIComponent on key/values or standard URLSearchParams
        // Standard URLSearchParams parser replaces invalid % sequences with U+FFFD instead of throwing.
        // We verify that percent encoding is valid UTF-8.
        const pairs = text.split('&')
        for (const pair of pairs) {
          if (!pair) {
            continue
          }
          const [rawKey, rawVal] = pair.split('=')
          if (rawKey) {
            decodeURIComponent(rawKey.replace(/\+/g, ' '))
          }
          if (rawVal) {
            decodeURIComponent(rawVal.replace(/\+/g, ' '))
          }
        }
        resolve(new URLSearchParams(text))
      } catch {
        reject(new ReadBodyError('malformed_encoding', 'Malformed URL encoding'))
      }
    }

    request.on('data', onData)
    request.on('end', onEnd)
    request.on('error', reject)
  })
}
