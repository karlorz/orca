import type { PaneManager } from '@/lib/pane-manager/pane-manager'
import type { PtyTransport } from './pty-transport'
import { handleTerminalProgrammaticTextPaste } from './terminal-programmatic-text-paste'
import { writeTerminalPastePtyInput } from './terminal-pty-paste-writer'
import {
  capDictationBackspaces,
  type TerminalBufferForDictationCap
} from './terminal-dictation-backspace-cap'

export type DictationReplaceTextDetail = {
  text?: string
  tabId?: string
  paneId?: number
  backspaces?: number
  liveSegment?: string
}

const replaceChains = new Map<string, Promise<void>>()

function enqueueDictationReplace(key: string, job: () => Promise<void>): void {
  const next = (replaceChains.get(key) ?? Promise.resolve()).then(job, job)
  const settled = next.then(
    () => undefined,
    () => undefined
  )
  replaceChains.set(key, settled)
  void settled.then(() => {
    if (replaceChains.get(key) === settled) {
      replaceChains.delete(key)
    }
  })
}

export function handleDictationReplaceTextEvent(args: {
  detail: DictationReplaceTextDetail | undefined
  tabId: string
  worktreeId: string
  getManager: () => PaneManager | null
  getPaneTransports: () => Map<number, PtyTransport>
}): void {
  const { detail, tabId, worktreeId, getManager, getPaneTransports } = args
  if (!detail || detail.tabId !== tabId) {
    return
  }
  const manager = getManager()
  if (!manager) {
    return
  }
  const panes = manager.getPanes()
  const pane =
    typeof detail.paneId === 'number'
      ? (panes.find((candidate) => candidate.id === detail.paneId) ?? null)
      : (manager.getActivePane() ?? panes[0])
  if (!pane) {
    return
  }
  const rawBackspaces = Math.max(0, Math.floor(Number(detail.backspaces) || 0))
  const liveSegment = detail.liveSegment
  const text = typeof detail.text === 'string' ? detail.text : ''
  enqueueDictationReplace(`${tabId}:${pane.id}`, async () => {
    // Why: cap against the buffer after earlier queued writes finished, not
    // at dispatch time when the screen still shows the previous partial.
    const livePane =
      getManager()
        ?.getPanes()
        .find((candidate) => candidate.id === pane.id) ?? pane
    const transport = getPaneTransports().get(livePane.id)
    const terminalBuffer = (
      livePane.terminal as { buffer?: { active?: TerminalBufferForDictationCap } } | undefined
    )?.buffer?.active
    const backspaces = capDictationBackspaces({
      buffer: terminalBuffer,
      requestedBackspaces: rawBackspaces,
      liveSegment
    })
    if (backspaces > 0) {
      await writeTerminalPastePtyInput(transport, '\x7f'.repeat(backspaces))
    }
    if (!text) {
      return
    }
    await handleTerminalProgrammaticTextPaste({
      detail: { tabId, text, paneId: livePane.id },
      tabId,
      worktreeId,
      getManager,
      getPaneTransports
    })
  })
}
