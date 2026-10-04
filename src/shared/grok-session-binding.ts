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
  return Object.entries(first).every(([key, value]) => Reflect.get(second, key) === value)
}
