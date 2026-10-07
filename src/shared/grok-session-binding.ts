export type GrokSessionTerminalOwner = {
  runtimeId: string
  executionHostId: string
  handle: string
  ptyId: string
  incarnationId: string
  paneKey: string
  tabId: string
  leafId: string
  worktreeId: string
  launchToken: string
}

export type GrokSessionBinding = Omit<GrokSessionTerminalOwner, 'launchToken'> & {
  provider: 'grok'
  sessionId: string
  boundaryAt: number
}

export type GrokSessionObservation = {
  owner: GrokSessionTerminalOwner
  sessionId: string
  boundaryAt: number
  eventAt: number
  retiredSessionIds: readonly string[]
  unverifiable?: true
}

export function sameGrokTerminalOwner(
  first: GrokSessionTerminalOwner,
  second: GrokSessionTerminalOwner
): boolean {
  return (
    first.runtimeId === second.runtimeId &&
    first.executionHostId === second.executionHostId &&
    first.handle === second.handle &&
    first.ptyId === second.ptyId &&
    first.incarnationId === second.incarnationId &&
    first.paneKey === second.paneKey &&
    first.tabId === second.tabId &&
    first.leafId === second.leafId &&
    first.worktreeId === second.worktreeId &&
    first.launchToken === second.launchToken
  )
}

export function sameGrokSessionBinding(
  first: GrokSessionBinding,
  second: GrokSessionBinding
): boolean {
  return (
    first.provider === second.provider &&
    first.sessionId === second.sessionId &&
    first.boundaryAt === second.boundaryAt &&
    first.runtimeId === second.runtimeId &&
    first.executionHostId === second.executionHostId &&
    first.handle === second.handle &&
    first.ptyId === second.ptyId &&
    first.incarnationId === second.incarnationId &&
    first.paneKey === second.paneKey &&
    first.tabId === second.tabId &&
    first.leafId === second.leafId &&
    first.worktreeId === second.worktreeId
  )
}
