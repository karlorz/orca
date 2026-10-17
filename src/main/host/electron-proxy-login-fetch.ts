import { Readable, Writable } from 'node:stream'
import { net, type Session } from 'electron'
import { getElectronProxyCredentialsForChallenge } from '../network/electron-proxy-credentials'

const NULL_BODY_STATUSES = [101, 204, 205, 304]

// Pull-driven so an unread body keeps backpressure on the native response.
function toWebBody(response: Readable): ReadableStream<Uint8Array> {
  const chunks: AsyncIterator<Uint8Array> = response[Symbol.asyncIterator]()
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await chunks.next()
      if (done) {
        controller.close()
      } else {
        controller.enqueue(value)
      }
    },
    cancel() {
      // Destroy directly: iterator return() would queue behind a pending read on a stalled body.
      response.destroy()
    }
  })
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('The operation was aborted.', 'AbortError')
}

export type ElectronNetRedirect = {
  statusCode: number
  method: string
  redirectUrl: string
  responseHeaders: Record<string, string[]>
  followRedirect: () => void
}

function headersFromElectron(
  responseHeaders: Record<string, string | string[]>,
  redirectUrl?: string
): Headers {
  const headers = new Headers()
  for (const [key, value] of Object.entries(responseHeaders)) {
    headers.set(key, Array.isArray(value) ? value.join(', ') : value)
  }
  if (redirectUrl && !headers.has('location')) {
    headers.set('location', redirectUrl)
  }
  return headers
}

/**
 * Electron's net.fetch with a proxy `login` listener. Its internal request has none, so
 * Electron cancels every proxy challenge and app 'login' never sees main-process requests.
 * Manual redirects resolve a 3xx Response unless `onRedirect` calls followRedirect.
 */
export function fetchWithProxyLogin(
  request: Request,
  proxySession: Session,
  onRedirect?: (redirect: ElectronNetRedirect) => void
): Promise<Response> {
  const { signal } = request
  if (signal.aborted) {
    void request.body?.cancel(abortReason(signal)).catch(() => {})
    return Promise.reject(abortReason(signal))
  }
  return new Promise((resolve, reject) => {
    const origin = request.headers.get('origin') ?? undefined
    const native = net.request({
      session: proxySession,
      method: request.method,
      url: request.url,
      origin,
      credentials:
        request.credentials === 'same-origin' && !origin ? 'include' : request.credentials,
      cache: request.cache,
      referrerPolicy: request.referrerPolicy,
      redirect: request.redirect
    })
    let aborted = false
    let settled = false
    const resolveOnce = (response: Response): void => {
      if (settled || aborted) {
        return
      }
      settled = true
      resolve(response)
    }
    const rejectOnce = (error: unknown): void => {
      if (settled || aborted) {
        return
      }
      settled = true
      reject(error)
    }
    signal.addEventListener(
      'abort',
      () => {
        aborted = true
        reject(abortReason(signal))
        void request.body?.cancel(abortReason(signal)).catch(() => {})
        native.abort()
      },
      { once: true }
    )
    let challenged = false
    native.on('login', (authInfo, callback) => {
      // A repeat challenge means the proxy rejected the credentials; cancel rather than loop.
      const credentials = challenged
        ? null
        : getElectronProxyCredentialsForChallenge(proxySession, authInfo)
      challenged = true
      if (credentials) {
        callback(credentials.username, credentials.password)
      } else {
        callback()
      }
    })
    native.on('redirect', (statusCode, method, redirectUrl, responseHeaders) => {
      if (aborted) {
        return
      }
      try {
        if (onRedirect) {
          onRedirect({
            statusCode,
            method,
            redirectUrl,
            responseHeaders,
            followRedirect: () => native.followRedirect()
          })
          return
        }
        if (request.redirect === 'manual') {
          resolveOnce(
            new Response(null, {
              status: statusCode,
              headers: headersFromElectron(responseHeaders, redirectUrl)
            })
          )
          return
        }
        if (request.redirect === 'error') {
          throw new Error('Redirect was cancelled')
        }
        native.followRedirect()
      } catch (error) {
        native.abort()
        rejectOnce(error)
      }
    })
    native.on('response', (response) => {
      if (aborted) {
        return
      }
      if (!(response instanceof Readable)) {
        native.abort()
        rejectOnce(new TypeError('Electron response is not a readable stream'))
        return
      }
      const bodyless = NULL_BODY_STATUSES.includes(response.statusCode) || request.method === 'HEAD'
      resolveOnce(
        new Response(bodyless ? null : toWebBody(response), {
          headers: headersFromElectron(response.headers),
          status: response.statusCode,
          statusText: response.statusMessage
        })
      )
    })
    native.on('error', rejectOnce)
    if (request.mode && (request.mode !== 'cors' || origin)) {
      native.setHeader('Sec-Fetch-Mode', request.mode)
    }
    for (const [key, value] of request.headers) {
      native.setHeader(key, value)
    }
    if (!request.body) {
      native.end()
    } else if (native instanceof Writable) {
      void request.body.pipeTo(Writable.toWeb(native)).then(() => native.end(), rejectOnce)
    } else {
      native.abort()
      rejectOnce(new TypeError('Electron request is not a writable stream'))
    }
  })
}
