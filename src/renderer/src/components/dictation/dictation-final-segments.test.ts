import { describe, expect, it } from 'vitest'
import {
  formatFinalTranscriptSegment,
  resolveDictationStopTranscript,
  shouldFinishDictationOnRemoteStop,
  unresolvedPartialTranscript
} from './dictation-final-segments'

describe('formatFinalTranscriptSegment', () => {
  it('adds a boundary between word-like streaming final segments', () => {
    expect(formatFinalTranscriptSegment('world', 'hello')).toBe(' world')
  })

  it('adds a boundary after sentence and phrase punctuation', () => {
    expect(formatFinalTranscriptSegment('World', 'Hello.')).toBe(' World')
    expect(formatFinalTranscriptSegment('world', 'hello,')).toBe(' world')
  })

  it('does not add a boundary before punctuation', () => {
    expect(formatFinalTranscriptSegment('.', 'hello')).toBe('.')
  })

  it('does not add a boundary around CJK final segments', () => {
    expect(formatFinalTranscriptSegment('世界', '你好')).toBe('世界')
  })
})

describe('unresolvedPartialTranscript', () => {
  it('returns the last partial when stop never received a final', () => {
    expect(unresolvedPartialTranscript(false, 'Testing Testing')).toBe('Testing Testing')
  })

  it('returns empty when a final already arrived', () => {
    expect(unresolvedPartialTranscript(true, 'Testing Testing')).toBe('')
  })

  it('returns empty when there was no usable partial', () => {
    expect(unresolvedPartialTranscript(false, '   ')).toBe('')
  })
})

describe('resolveDictationStopTranscript', () => {
  it('commits the last partial when stop never received a final', () => {
    expect(
      resolveDictationStopTranscript({
        sessionErrored: false,
        receivedFinal: false,
        lastPartial: 'Testing Testing',
        capturedChunkCount: 4
      })
    ).toEqual({ type: 'commit', text: 'Testing Testing' })
  })

  it('toasts empty only when audio existed and there was no partial', () => {
    expect(
      resolveDictationStopTranscript({
        sessionErrored: false,
        receivedFinal: false,
        lastPartial: '',
        capturedChunkCount: 3
      })
    ).toEqual({ type: 'empty' })
  })

  it('does nothing when a final already arrived', () => {
    expect(
      resolveDictationStopTranscript({
        sessionErrored: false,
        receivedFinal: true,
        lastPartial: 'Testing Testing',
        capturedChunkCount: 4
      })
    ).toEqual({ type: 'none' })
  })
})

describe('shouldFinishDictationOnRemoteStop', () => {
  it('finishes when Apple Speech ends the listen after a pause', () => {
    expect(shouldFinishDictationOnRemoteStop('listening')).toBe(true)
    expect(shouldFinishDictationOnRemoteStop('starting')).toBe(true)
  })

  it('does not re-enter finish when the user already stopped', () => {
    expect(shouldFinishDictationOnRemoteStop('stopping')).toBe(false)
    expect(shouldFinishDictationOnRemoteStop('idle')).toBe(false)
  })
})
