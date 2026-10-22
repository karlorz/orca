import { describe, expect, it, vi } from 'vitest'
import { probeHomeDaemonAdapters, type HomeDaemonProbeAdapter } from './home-appimage-daemon-probe'
import { assertHomeDaemonProtocol, HomeUpdateGateError } from './home-appimage-release-policy'

function refused(code = 'ECONNREFUSED'): Error {
  return Object.assign(new Error(`connect ${code} /run/daemon.sock`), { code, syscall: 'connect' })
}

function adapter(
  protocolVersion: number,
  listSessions: () => Promise<unknown> = async () => []
): HomeDaemonProbeAdapter {
  return { protocolVersion, listSessions: vi.fn(listSessions) }
}

const metadata49 = { schemaVersion: 1 as const, tag: 'v1.4.230-2', daemonProtocol: 49 }

describe('home AppImage GUI daemon probe', () => {
  it('skips stale refused legacy generations while the current v49 daemon matches', async () => {
    const state = await probeHomeDaemonAdapters([
      adapter(45, () => Promise.reject(refused())),
      adapter(48, () => Promise.reject(refused('ENOENT'))),
      adapter(49)
    ])
    expect(state).toEqual({ protocols: [49], skipped: [45, 48] })
    expect(() => assertHomeDaemonProtocol(metadata49, 'v1.4.230-2', state)).not.toThrow()
  })

  it('reports none-live when every socket is refused, and the gate blocks it as retryable', async () => {
    const state = await probeHomeDaemonAdapters([
      adapter(45, () => Promise.reject(refused())),
      adapter(49, () => Promise.reject(refused()))
    ])
    expect(state).toMatchObject({ protocols: null, reason: 'none-live' })
    let blocked: unknown
    try {
      assertHomeDaemonProtocol(metadata49, 'v1.4.230-2', state)
    } catch (error) {
      blocked = error
    }
    expect(blocked).toBeInstanceOf(HomeUpdateGateError)
    expect(blocked).toMatchObject({ kind: 'daemon-state-unknown', retryable: true })
  })

  it('reports none-live when no daemon generation is registered', async () => {
    expect(await probeHomeDaemonAdapters([])).toMatchObject({
      protocols: null,
      reason: 'none-live'
    })
  })

  it('fails closed on a non-refusal adapter error even when another generation answers', async () => {
    const state = await probeHomeDaemonAdapters([
      adapter(48, () => Promise.reject(new Error('Hello response timed out'))),
      adapter(49)
    ])
    expect(state).toEqual({ protocols: null, reason: 'adapter-error', detail: 'protocol 48' })
  })

  it('treats a token-file ENOENT (no connect syscall) as an adapter error, not a dead socket', async () => {
    const tokenMissing = Object.assign(new Error('ENOENT token'), { code: 'ENOENT' })
    const state = await probeHomeDaemonAdapters([
      adapter(48, () => Promise.reject(tokenMissing)),
      adapter(49)
    ])
    expect(state).toMatchObject({ protocols: null, reason: 'adapter-error' })
  })

  it('reports a timeout when a generation never answers within the shared deadline', async () => {
    const state = await probeHomeDaemonAdapters(
      [adapter(48, () => new Promise(() => undefined)), adapter(49)],
      20
    )
    expect(state).toEqual({ protocols: null, reason: 'timeout', detail: 'protocol 48' })
  })
})
