// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest'
import { createDictationLiveInserter } from './dictation-live-insertion'

describe('createDictationLiveInserter', () => {
  afterEach(() => {
    document.body.replaceChildren()
  })

  it('streams replace-in-place into a textarea from the first partial', () => {
    const element = document.createElement('textarea')
    element.value = 'prefix '
    element.selectionStart = element.selectionEnd = element.value.length
    document.body.append(element)
    const inserter = createDictationLiveInserter({ kind: 'text', element })

    expect(inserter.applyPartial('我想')).toBe(true)
    expect(element.value).toBe('prefix 我想')
    expect(inserter.applyPartial('我想食飯')).toBe(true)
    expect(element.value).toBe('prefix 我想食飯')
  })

  it('rewrites the active segment when Apple revises the partial', () => {
    const element = document.createElement('textarea')
    document.body.append(element)
    const inserter = createDictationLiveInserter({ kind: 'text', element })

    inserter.applyPartial('我想食反')
    expect(element.value).toBe('我想食反')
    inserter.applyPartial('我想食飯')
    expect(element.value).toBe('我想食飯')
  })

  it('ignores an empty partial so a wrap or Apple gap cannot wipe the live segment', () => {
    const element = document.createElement('textarea')
    document.body.append(element)
    const inserter = createDictationLiveInserter({ kind: 'text', element })

    inserter.applyPartial('今日天氣好好好所以我想講多幾句')
    expect(inserter.applyPartial('')).toBe(true)
    expect(element.value).toBe('今日天氣好好好所以我想講多幾句')
  })

  it('freezes a pause segment and starts the next one after it', () => {
    const element = document.createElement('textarea')
    document.body.append(element)
    const inserter = createDictationLiveInserter({ kind: 'text', element })

    inserter.applyPartial('今日')
    inserter.freezeSegment('今日天氣好')
    inserter.applyPartial('唔錯')
    expect(element.value).toBe('今日天氣好唔錯')
  })

  it('freezes when the user edits the live segment', () => {
    const element = document.createElement('textarea')
    document.body.append(element)
    const inserter = createDictationLiveInserter({ kind: 'text', element })
    inserter.applyPartial('hello')
    element.value = 'hexxo'
    expect(inserter.applyPartial('hello world')).toBe(false)
  })

  it('is disabled when no insertion target was captured', () => {
    const inserter = createDictationLiveInserter(null)
    expect(inserter.hasTarget).toBe(false)
    expect(inserter.applyPartial('hello')).toBe(false)
  })

  it('dispatches dictation:replaceText event with liveSegment on terminal target', () => {
    const events: CustomEvent[] = []
    const listener = (event: Event) => {
      events.push(event as CustomEvent)
    }
    document.addEventListener('dictation:replaceText', listener)

    try {
      const inserter = createDictationLiveInserter({
        kind: 'terminal',
        tabId: 'tab-1',
        paneId: 2
      })

      expect(inserter.applyPartial('你好')).toBe(true)
      expect(events).toHaveLength(1)
      expect(events[0].detail).toEqual({
        tabId: 'tab-1',
        paneId: 2,
        backspaces: 0,
        text: '你好',
        liveSegment: ''
      })

      expect(inserter.applyPartial('世界')).toBe(true)
      expect(events).toHaveLength(2)
      expect(events[1].detail).toEqual({
        tabId: 'tab-1',
        paneId: 2,
        backspaces: 2,
        text: '世界',
        liveSegment: '你好'
      })
    } finally {
      document.removeEventListener('dictation:replaceText', listener)
    }
  })
})
