import { useAppStore } from '@/store'
import { hasWorktreeTeardownStarted } from '@/store/slices/worktree-delete-state-types'
import type { ConnectPanePtySession } from './connect-pane-pty-session'
import type { PendingStartupCommand } from './fresh-spawn-types'

export function createFreshSpawnCwdFence(session: ConnectPanePtySession): {
  release: () => void
  shouldSkip: (startupOverride?: PendingStartupCommand | null) => boolean
} {
  const release = (): void => {
    if (!session.transport.getPtyId()) {
      // Abandoned spawns never connect; discard buffered input and settle its write promises here.
      session.transport.abandonPreconnectInput?.()
      try {
        session.deps.onDeferredCwdSpawnFailed?.()
      } catch {
        // A cleanup callback must not turn a settled spawn into an unhandled rejection.
      }
    }
  }

  return {
    release,
    shouldSkip: (startupOverride?: PendingStartupCommand | null): boolean => {
      if (
        hasWorktreeTeardownStarted(
          useAppStore.getState().deleteStateByWorktreeId?.[session.deps.worktreeId]
        )
      ) {
        return true
      }
      const effectiveStartup = startupOverride === undefined ? session.paneStartup : startupOverride
      return effectiveStartup?.resumeSource?.cancelled === true
    }
  }
}
