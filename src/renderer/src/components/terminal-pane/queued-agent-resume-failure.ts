import { useAppStore } from '@/store'
import { agentProviderSessionsEqual } from '../../../../shared/agent-session-resume'
import type { PtyPaneStartup } from './pty-connection-types'
import { paneOwnsQueuedStartup } from './terminal-pane-lifecycle-primitives'

export function createQueuedAgentResumeFailureHandler(
  tabId: string,
  paneStartup: PtyPaneStartup | undefined,
  queuedStartup: PtyPaneStartup | undefined,
  expectedStartup = queuedStartup
): (() => boolean) | undefined {
  if (
    !queuedStartup?.launchAgent ||
    !queuedStartup.resumeProviderSession ||
    !paneOwnsQueuedStartup(paneStartup, queuedStartup)
  ) {
    return undefined
  }
  const expectedClaim = useAppStore.getState().automaticAgentResumeClaimsByTabId[tabId]
  return () => {
    let released = false
    useAppStore.setState((state) => {
      if (state.pendingStartupByTabId[tabId] !== expectedStartup) {
        return state
      }
      const claim = state.automaticAgentResumeClaimsByTabId[tabId]
      if (claim !== expectedClaim) {
        return state
      }
      if (
        claim &&
        (claim.launchAgent !== queuedStartup.launchAgent ||
          !agentProviderSessionsEqual(
            claim.launchAgent,
            claim.providerSession,
            queuedStartup.resumeProviderSession
          ))
      ) {
        return state
      }
      const pendingStartupByTabId = { ...state.pendingStartupByTabId }
      const automaticAgentResumeClaimsByTabId = { ...state.automaticAgentResumeClaimsByTabId }
      delete pendingStartupByTabId[tabId]
      delete automaticAgentResumeClaimsByTabId[tabId]
      released = true
      return { pendingStartupByTabId, automaticAgentResumeClaimsByTabId }
    })
    return released
  }
}
