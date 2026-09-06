import type { MobileDictationLiveSnapshot } from '../hooks/mobile-dictation-session-state'
import {
  computeMobileLiveComposerValue,
  computeMobileLivePtyPayload,
  enqueueMobilePtySend,
  resolveMobileLiveSpoken
} from './mobile-dictation-live-apply'

export type MobileLiveSessionRefs = {
  revision: { current: number }
  baseline: { current: string | null }
  spoken: { current: string }
}

export function resetMobileLiveSession(refs: MobileLiveSessionRefs): void {
  refs.revision.current = 0
  refs.baseline.current = null
  refs.spoken.current = ''
}

export function applyMobileLiveSnapshot(args: {
  snapshot: MobileDictationLiveSnapshot
  refs: MobileLiveSessionRefs
  showNativeChat: boolean
  liveInputEnabled: boolean
  insertHandle: string | null
  setChatComposerText: (updater: (current: string) => string) => void
  setInput: (updater: (current: string) => string) => void
  sendLiveTerminalInput: (handle: string, bytes: string) => Promise<boolean>
}): void {
  const { snapshot, refs } = args
  if (snapshot.live !== true || typeof snapshot.revision !== 'number') {
    return
  }
  if (snapshot.revision <= refs.revision.current) {
    return
  }
  refs.revision.current = snapshot.revision
  const spoken = resolveMobileLiveSpoken({
    committedText: snapshot.committedText,
    partialText: snapshot.partialText,
    previousSpoken: refs.spoken.current
  })
  if (args.showNativeChat) {
    args.setChatComposerText((current) => {
      if (refs.baseline.current === null) {
        refs.baseline.current = current
      }
      return computeMobileLiveComposerValue({ baseline: refs.baseline.current, spoken })
    })
    refs.spoken.current = spoken
    return
  }
  if (args.liveInputEnabled) {
    const insertHandle = args.insertHandle
    if (!insertHandle) {
      return
    }
    const delta = computeMobileLivePtyPayload({
      previousSpoken: refs.spoken.current,
      nextSpoken: spoken
    })
    refs.spoken.current = delta.spoken
    if (!delta.payload) {
      return
    }
    void enqueueMobilePtySend(`pty:${insertHandle}`, async () => {
      await args.sendLiveTerminalInput(insertHandle, delta.payload as string)
    })
    return
  }
  args.setInput((current) => {
    if (refs.baseline.current === null) {
      refs.baseline.current = current
    }
    return computeMobileLiveComposerValue({ baseline: refs.baseline.current, spoken })
  })
  refs.spoken.current = spoken
}

export function applyMobileLiveFinish(args: {
  text: string
  refs: MobileLiveSessionRefs
  showNativeChat: boolean
  liveInputEnabled: boolean
  insertHandle: string | null
  setChatComposerText: (updater: (current: string) => string) => void
  setInput: (updater: (current: string) => string) => void
  sendLiveTerminalInput: (handle: string, bytes: string) => Promise<boolean>
}): boolean {
  if (args.refs.revision.current <= 0) {
    return false
  }
  const lastSpoken = args.refs.spoken.current
  const baseline = args.refs.baseline.current
  resetMobileLiveSession(args.refs)
  if (args.showNativeChat) {
    args.setChatComposerText((current) => `${baseline ?? current}${args.text}`)
    return true
  }
  if (!args.liveInputEnabled) {
    args.setInput((current) => `${baseline ?? current}${args.text}`)
    return true
  }
  const insertHandle = args.insertHandle
  if (!insertHandle) {
    return true
  }
  const delta = computeMobileLivePtyPayload({
    previousSpoken: lastSpoken,
    nextSpoken: args.text
  })
  if (!delta.payload) {
    return true
  }
  void enqueueMobilePtySend(`pty:${insertHandle}`, async () => {
    await args.sendLiveTerminalInput(insertHandle, delta.payload as string)
  })
  return true
}
