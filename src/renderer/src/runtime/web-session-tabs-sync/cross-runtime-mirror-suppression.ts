import { getRuntimeOwnerEnvironments } from '@/lib/runtime-owner-catalog'
import { sameCanonicalRuntimeOwner } from '../../../../shared/runtime-environment-owner'
import { getRemoteRuntimePtyEnvironmentId } from '../runtime-terminal-stream'
import type { TerminalTab } from '../../../../shared/terminal-tab-types'
import { isMirroredTerminalSurfaceId } from './terminal-surfaces'

/**
 * Whether this worktree is already mirrored here from another paired runtime.
 *
 * A mirrored terminal's PTY id names the runtime that minted it, so a live one proves this
 * client is paired to that runtime directly. A frame from a different runtime is then a
 * second-hand view of the same tabs, and admitting it duplicates the strip.
 */
export function crossRuntimeMirrorSuppressesFrame(
  currentTabs: readonly TerminalTab[],
  frameEnvironmentId: string
): boolean {
  const environments = getRuntimeOwnerEnvironments()
  for (const tab of currentTabs) {
    if (!tab.ptyId || !isMirroredTerminalSurfaceId(tab.id)) {
      continue
    }
    const sourceEnvironmentId = getRemoteRuntimePtyEnvironmentId(tab.ptyId)
    if (!sourceEnvironmentId) {
      continue
    }
    if (!sameCanonicalRuntimeOwner(sourceEnvironmentId, frameEnvironmentId, environments)) {
      return true
    }
  }
  return false
}
