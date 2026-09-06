import { useEffect, type MutableRefObject, type RefObject } from 'react'
import type { PaneManager } from '@/lib/pane-manager/pane-manager'
import type { PtyTransport } from './pty-transport'
import { handleTerminalProgrammaticTextPaste } from './terminal-programmatic-text-paste'
import { handleDictationReplaceTextEvent } from './terminal-dictation-replace'

export function useTerminalDictationEvents(args: {
  tabId: string
  worktreeIdRef: MutableRefObject<string>
  isActiveRef: MutableRefObject<boolean>
  managerRef: RefObject<PaneManager | null>
  paneTransportsRef: MutableRefObject<Map<number, PtyTransport>>
}): void {
  const { tabId, worktreeIdRef, isActiveRef, managerRef, paneTransportsRef } = args
  useEffect(() => {
    if (typeof document === 'undefined') {
      return
    }
    const onDictationInsert = (event: Event): void => {
      if (!isActiveRef.current) {
        return
      }
      const detail = (
        event as CustomEvent<string | { text?: string; tabId?: string; paneId?: number }>
      ).detail
      const text = typeof detail === 'string' ? detail : detail?.text
      if (!text) {
        return
      }
      if (typeof detail === 'object' && detail.tabId && detail.tabId !== tabId) {
        return
      }
      const requestedPaneId = typeof detail === 'object' ? detail.paneId : undefined
      handleTerminalProgrammaticTextPaste({
        detail: {
          tabId,
          text,
          ...(typeof requestedPaneId === 'number' ? { paneId: requestedPaneId } : {})
        },
        tabId,
        worktreeId: worktreeIdRef.current,
        getManager: () => managerRef.current,
        getPaneTransports: () => paneTransportsRef.current
      })
    }
    const onDictationReplace = (event: Event): void => {
      if (!isActiveRef.current) {
        return
      }
      handleDictationReplaceTextEvent({
        detail: (
          event as CustomEvent<{
            text?: string
            tabId?: string
            paneId?: number
            backspaces?: number
            liveSegment?: string
          }>
        ).detail,
        tabId,
        worktreeId: worktreeIdRef.current,
        getManager: () => managerRef.current,
        getPaneTransports: () => paneTransportsRef.current
      })
    }
    document.addEventListener('dictation:insertText', onDictationInsert)
    document.addEventListener('dictation:replaceText', onDictationReplace)
    return () => {
      document.removeEventListener('dictation:insertText', onDictationInsert)
      document.removeEventListener('dictation:replaceText', onDictationReplace)
    }
  }, [isActiveRef, managerRef, paneTransportsRef, tabId, worktreeIdRef])
}
