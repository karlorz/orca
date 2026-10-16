export const WORKTREE_GC_BUSY_MARKS = [
  'ctrl+c to stop',
  'Calling',
  'Thinking',
  'Running',
  'Waiting…',
  'Generating',
  'esc to interrupt'
] as const

export function isWorktreeGcBusyTail(tail: string): boolean {
  return WORKTREE_GC_BUSY_MARKS.some((mark) => tail.includes(mark))
}

export function classifyGcTerminalIdle(input: {
  lastOutputAt: number | null
  tail: string
  nowMs: number
  idleTermMin: number
  isCoord: boolean
}): { action: 'keep' | 'close'; why: string } {
  if (input.isCoord) {
    return { action: 'keep', why: 'coord' }
  }
  if (isWorktreeGcBusyTail(input.tail)) {
    return { action: 'keep', why: 'busy' }
  }
  const lastOutputAt = input.lastOutputAt ?? input.nowMs
  const idleMs = input.nowMs - lastOutputAt
  if (idleMs < input.idleTermMin * 60 * 1000) {
    return { action: 'keep', why: `recent-output(${Math.floor(idleMs / 60_000)}m)` }
  }
  return { action: 'close', why: 'idle' }
}
