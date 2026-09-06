import { describe, expect, it } from 'vitest'
import {
  applyMobileLiveFinish,
  applyMobileLiveSnapshot,
  resetMobileLiveSession,
  type MobileLiveSessionRefs
} from './mobile-dictation-live-session'

function createRefs(overrides: Partial<MobileLiveSessionRefs> = {}): MobileLiveSessionRefs {
  return {
    revision: { current: 0 },
    baseline: { current: null },
    spoken: { current: '' },
    ...overrides
  }
}

describe('mobile-dictation-live-session', () => {
  it('inserts the first live partial into the composer from the snapshot', () => {
    const refs = createRefs()
    let composer = 'prefix '
    applyMobileLiveSnapshot({
      snapshot: { live: true, revision: 1, committedText: '', partialText: '我想' },
      refs,
      showNativeChat: true,
      liveInputEnabled: false,
      insertHandle: null,
      setChatComposerText: (updater) => {
        composer = updater(composer)
      },
      setInput: () => undefined,
      sendLiveTerminalInput: async () => true
    })
    expect(composer).toBe('prefix 我想')
    expect(refs.spoken.current).toBe('我想')
    expect(refs.revision.current).toBe(1)
  })

  it('does not apply an older or non-live snapshot', () => {
    const refs = createRefs()
    refs.revision.current = 2
    refs.spoken.current = '今日'
    let composer = 'prefix 今日'
    applyMobileLiveSnapshot({
      snapshot: { live: true, revision: 2, committedText: '', partialText: '' },
      refs,
      showNativeChat: true,
      liveInputEnabled: false,
      insertHandle: null,
      setChatComposerText: (updater) => {
        composer = updater(composer)
      },
      setInput: () => undefined,
      sendLiveTerminalInput: async () => true
    })
    expect(composer).toBe('prefix 今日')
    expect(refs.spoken.current).toBe('今日')
  })

  it('sends the first PTY payload while holding, then skips a keepLength-0 rewrite', async () => {
    const refs = createRefs()
    const sent: string[] = []
    applyMobileLiveSnapshot({
      snapshot: { live: true, revision: 1, committedText: '', partialText: '你好' },
      refs,
      showNativeChat: false,
      liveInputEnabled: true,
      insertHandle: 'pty-1',
      setChatComposerText: () => undefined,
      setInput: () => undefined,
      sendLiveTerminalInput: async (_handle, bytes) => {
        sent.push(bytes)
        return true
      }
    })
    applyMobileLiveSnapshot({
      snapshot: { live: true, revision: 2, committedText: '', partialText: '世界' },
      refs,
      showNativeChat: false,
      liveInputEnabled: true,
      insertHandle: 'pty-1',
      setChatComposerText: () => undefined,
      setInput: () => undefined,
      sendLiveTerminalInput: async (_handle, bytes) => {
        sent.push(bytes)
        return true
      }
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(sent).toEqual(['你好'])
    expect(refs.spoken.current).toBe('你好')
  })

  it('applies a finish suffix without a keepLength-0 full rewrite', async () => {
    const refs = createRefs()
    refs.revision.current = 1
    refs.spoken.current = '你好'
    const sent: string[] = []
    const handled = applyMobileLiveFinish({
      text: '世界',
      refs,
      showNativeChat: false,
      liveInputEnabled: true,
      insertHandle: 'pty-1',
      setChatComposerText: () => undefined,
      setInput: () => undefined,
      sendLiveTerminalInput: async (_handle, bytes) => {
        sent.push(bytes)
        return true
      }
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(handled).toBe(true)
    expect(sent).toEqual([])
    expect(refs.revision.current).toBe(0)
  })

  it('returns false when finish runs with no live revision so the buffered path can insert', () => {
    const refs = createRefs()
    expect(
      applyMobileLiveFinish({
        text: '你好',
        refs,
        showNativeChat: false,
        liveInputEnabled: false,
        insertHandle: null,
        setChatComposerText: () => undefined,
        setInput: () => undefined,
        sendLiveTerminalInput: async () => true
      })
    ).toBe(false)
  })

  it('resetMobileLiveSession clears revision, baseline, and spoken', () => {
    const refs = createRefs()
    refs.revision.current = 4
    refs.baseline.current = 'prefix '
    refs.spoken.current = '你好'
    resetMobileLiveSession(refs)
    expect(refs).toEqual({
      revision: { current: 0 },
      baseline: { current: null },
      spoken: { current: '' }
    })
  })
})
