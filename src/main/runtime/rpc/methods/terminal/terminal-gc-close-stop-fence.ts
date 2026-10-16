import { classifyGcTerminalIdle } from '../../../../../shared/worktree-gc-terminal-idle'

export type TerminalGcCloseStopOptions = {
  expectedIncarnationId?: string
  gcIdleTermMin?: number
  gcCoordHandle?: string
}

export function capturePtyIncarnationIds(
  ptysById: { get(id: string): { incarnationId?: string } | undefined },
  ptyIds: readonly string[]
): Map<string, string> {
  const captured = new Map<string, string>()
  for (const ptyId of ptyIds) {
    const incarnationId = ptysById.get(ptyId)?.incarnationId
    if (incarnationId) {
      captured.set(ptyId, incarnationId)
    }
  }
  return captured
}

export function gcCloseAfterAwaitVerdict(input: {
  expectedIncarnationId?: string
  liveIncarnationId?: string | null
  lastOutputAt?: number | null
  tail?: string
  nowMs: number
  gcIdleTermMin?: number
  isCoord: boolean
}): { ok: true } | { ok: false; why: string } {
  if (input.expectedIncarnationId) {
    if (!input.liveIncarnationId) {
      return { ok: false, why: 'incarnation-unverifiable' }
    }
    if (input.liveIncarnationId !== input.expectedIncarnationId) {
      return { ok: false, why: 'incarnation-changed' }
    }
  }
  if (input.gcIdleTermMin === undefined) {
    return { ok: true }
  }
  const idle = classifyGcTerminalIdle({
    lastOutputAt: input.lastOutputAt ?? null,
    tail: input.tail ?? '',
    nowMs: input.nowMs,
    idleTermMin: input.gcIdleTermMin,
    isCoord: input.isCoord
  })
  if (idle.action !== 'close') {
    return { ok: false, why: idle.why }
  }
  return { ok: true }
}

export function gcCloseRefuseError(why: string, gcIdleTermMin: number | undefined): Error {
  return new Error(
    gcIdleTermMin === undefined ? 'terminal_handle_stale' : `gc_close_refused:${why}`
  )
}

export type GcCloseStopHost = {
  ptysById: {
    get(id: string): { incarnationId?: string; lastOutputAt?: number | null } | undefined
  }
  stopExplicitlyClosedTabPtys(
    ptyIds: readonly string[],
    addressedPtyId: string,
    capturedIncarnations?: ReadonlyMap<string, string>
  ): Promise<{ stopped: boolean }>
}

export async function finishGuardedPtyStop(
  host: GcCloseStopHost,
  handle: string,
  ptyIds: readonly string[],
  addressedPtyId: string,
  capturedIncarnations: ReadonlyMap<string, string>,
  options?: TerminalGcCloseStopOptions
): Promise<{ stopped: boolean }> {
  const live = host.ptysById.get(addressedPtyId)
  const verdict = gcCloseAfterAwaitVerdict({
    expectedIncarnationId:
      options?.expectedIncarnationId ?? capturedIncarnations.get(addressedPtyId),
    liveIncarnationId: live?.incarnationId,
    lastOutputAt: live?.lastOutputAt,
    nowMs: Date.now(),
    gcIdleTermMin: options?.gcIdleTermMin,
    isCoord: Boolean(options?.gcCoordHandle && handle === options.gcCoordHandle)
  })
  if (!verdict.ok) {
    throw gcCloseRefuseError(verdict.why, options?.gcIdleTermMin)
  }
  return host.stopExplicitlyClosedTabPtys(ptyIds, addressedPtyId, capturedIncarnations)
}
