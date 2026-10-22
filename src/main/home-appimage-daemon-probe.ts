import { isDaemonEndpointGoneError } from './daemon/daemon-errors'
import type { HomeLiveDaemonState } from './home-appimage-release-policy'

export const HOME_DAEMON_PROBE_TIMEOUT_MS = 5_000

export type HomeDaemonProbeAdapter = {
  readonly protocolVersion: number
  listSessions(): Promise<unknown>
}

type AdapterOutcome =
  | { kind: 'live'; protocol: number }
  | { kind: 'gone'; protocol: number }
  | { kind: 'error'; protocol: number }
  | { kind: 'timeout'; protocol: number }

/**
 * Asks every daemon generation for its sessions within one shared deadline.
 * Why skip gone endpoints: a legacy generation whose socket refuses connections (or no longer
 * exists) proves nothing can be served from it, so it must not veto an otherwise verified
 * inventory. Anything else (timeout, handshake or request error) leaves the state unknown, and
 * an inventory where nothing answered is unknown too: an empty list never authorizes an install.
 */
export async function probeHomeDaemonAdapters(
  adapters: readonly HomeDaemonProbeAdapter[],
  timeoutMs = HOME_DAEMON_PROBE_TIMEOUT_MS
): Promise<HomeLiveDaemonState> {
  if (adapters.length === 0) {
    return { protocols: null, reason: 'none-live', detail: 'no daemon generations registered' }
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs)
    timer.unref?.()
  })
  try {
    const outcomes = await Promise.all(
      adapters.map(async (adapter): Promise<AdapterOutcome> => {
        const protocol = adapter.protocolVersion
        const answered = adapter.listSessions().then(
          () => ({ kind: 'live', protocol }) as const,
          (error: unknown) =>
            isDaemonEndpointGoneError(error)
              ? ({ kind: 'gone', protocol } as const)
              : ({ kind: 'error', protocol } as const)
        )
        const result = await Promise.race([answered, deadline])
        return result === 'timeout' ? { kind: 'timeout', protocol } : result
      })
    )
    const failed = (kind: AdapterOutcome['kind']): number[] =>
      outcomes.filter((outcome) => outcome.kind === kind).map((outcome) => outcome.protocol)
    const timedOut = failed('timeout')
    if (timedOut.length > 0) {
      return { protocols: null, reason: 'timeout', detail: `protocol ${timedOut.join(', ')}` }
    }
    const errored = failed('error')
    if (errored.length > 0) {
      return { protocols: null, reason: 'adapter-error', detail: `protocol ${errored.join(', ')}` }
    }
    const live = failed('live')
    const gone = failed('gone')
    if (live.length === 0) {
      return {
        protocols: null,
        reason: 'none-live',
        detail: `refused: protocol ${gone.join(', ')}`
      }
    }
    return { protocols: live, ...(gone.length > 0 ? { skipped: gone } : {}) }
  } finally {
    clearTimeout(timer)
  }
}
