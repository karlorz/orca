import {
  sameGrokSessionBinding,
  sameGrokTerminalOwner,
  type GrokSessionBinding,
  type GrokSessionObservation,
  type GrokSessionTerminalOwner
} from '../../shared/grok-session-binding'
import type { TerminalRevealIdentity } from '../../shared/terminal-reveal-identity'

export type TerminalSessionNavigationAuthority = {
  observations(): readonly GrokSessionObservation[]
  owner(paneKey: string): GrokSessionTerminalOwner | null
  reveal(
    binding: GrokSessionBinding,
    stillCurrent: () => boolean
  ): Promise<{
    identity?: TerminalRevealIdentity
    windowFocused?: boolean
    paneFocused?: boolean
  }>
}

export class TerminalSessionNavigation {
  constructor(private readonly authority: TerminalSessionNavigationAuthority) {}

  resolve(sessionId: string): GrokSessionBinding {
    const observations = this.authority.observations().filter((row) => row.sessionId === sessionId)
    if (observations.length !== 1) {
      throw new Error(
        observations.length > 1 ? 'session_binding_ambiguous' : 'session_binding_unverifiable'
      )
    }
    const observation = observations[0]
    if (observation.unverifiable) {
      throw new Error('session_binding_unverifiable')
    }
    const owner = this.authority.owner(observation.owner.paneKey)
    if (!owner || !sameGrokTerminalOwner(owner, observation.owner)) {
      throw new Error('session_binding_unverifiable')
    }
    const { launchToken: _launchToken, ...identity } = owner
    return { ...identity, provider: 'grok', sessionId, boundaryAt: observation.boundaryAt }
  }

  async navigate(sessionId: string): Promise<{
    binding: GrokSessionBinding
    navigated: boolean
    windowFocused?: boolean
    paneFocused?: boolean
  }> {
    const binding = this.resolve(sessionId)
    const receipt = await this.authority.reveal(binding, () => {
      try {
        return sameGrokSessionBinding(binding, this.resolve(sessionId))
      } catch {
        return false
      }
    })
    const current = this.resolve(sessionId)
    if (
      !sameGrokSessionBinding(binding, current) ||
      !receipt.identity ||
      receipt.identity.ptyId !== binding.ptyId ||
      receipt.identity.tabId !== binding.tabId ||
      receipt.identity.leafId !== binding.leafId ||
      receipt.identity.worktreeId !== binding.worktreeId
    ) {
      throw new Error('session_navigation_unverifiable')
    }
    return {
      binding,
      navigated: true,
      ...(receipt.windowFocused !== undefined ? { windowFocused: receipt.windowFocused } : {}),
      ...(receipt.paneFocused !== undefined ? { paneFocused: receipt.paneFocused } : {})
    }
  }
}
