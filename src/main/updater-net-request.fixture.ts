import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import { vi, type Mock } from 'vitest'

type NetFetchResponse = {
  ok?: boolean
  status?: number
  headers?: Record<string, string>
  text?: () => Promise<string>
}

function responseStatus(response: NetFetchResponse): number {
  return response.status ?? (response.ok ? 200 : 503)
}

function redirectLocation(response: NetFetchResponse): string {
  const location = response.headers?.location
  return location && location.length > 0 ? location : 'https://redirect.test'
}

function incomingMessage(status: number, headers: Record<string, string>, body: Buffer): Readable {
  return Object.assign(Readable.from(body.length > 0 ? [body] : []), {
    statusCode: status,
    statusMessage: '',
    headers
  })
}

export function installNetRequestFetchAdapter(netRequestMock: Mock, netFetchMock: Mock): void {
  netRequestMock.mockImplementation(
    (options: { method?: string; redirect?: string; url: string }) => {
      const request = new EventEmitter()
      let followed = false
      const dispatch = (url: string): void => {
        Promise.resolve(netFetchMock(url, { method: options.method, redirect: options.redirect }))
          .then(async (response: NetFetchResponse) => {
            const status = responseStatus(response)
            if (options.redirect === 'manual' && status >= 300 && status < 400) {
              const redirectUrl = redirectLocation(response)
              followed = false
              request.emit('redirect', status, options.method ?? 'GET', redirectUrl, {
                location: [redirectUrl]
              })
              // Why: Electron cancels an unfollowed manual redirect and then emits 'error'.
              if (!followed) {
                request.emit('error', new Error('Redirect was cancelled'))
                return
              }
              dispatch(redirectUrl)
              return
            }
            const body =
              typeof response.text === 'function'
                ? Buffer.from(await response.text())
                : Buffer.alloc(0)
            request.emit('response', incomingMessage(status, response.headers ?? {}, body))
          })
          .catch((error: unknown) => request.emit('error', error))
      }
      Object.assign(request, {
        abort: vi.fn(),
        setHeader: vi.fn(),
        followRedirect: vi.fn(() => {
          followed = true
        }),
        end: vi.fn(() => {
          dispatch(options.url)
          return request
        })
      })
      return request
    }
  )
}
