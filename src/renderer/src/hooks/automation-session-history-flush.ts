import { useAppStore } from '@/store'

/** Claude writes jsonl after `done`; killing the PTY first yields an empty `--resume`. */
export const CLAUDE_SESSION_HISTORY_FLUSH_MS = 6000

export async function waitForAutomationSessionHistoryFlush(
  paneKey: string | null | undefined
): Promise<void> {
  if (!paneKey) {
    return
  }
  const agent = useAppStore.getState().agentStatusByPaneKey?.[paneKey]?.agentType
  if (agent !== 'claude') {
    return
  }
  await new Promise<void>((resolve) => {
    setTimeout(resolve, CLAUDE_SESSION_HISTORY_FLUSH_MS)
  })
}
