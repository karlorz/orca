import { describe, expect, it } from 'vitest'
import { mediaShouldStartTts } from './pet-speech-media-command-start-tts'

describe('media command never starts TTS', () => {
  it('fail-closed RESUME IGNORE and RELEASE_AND_STOP_TTS never start TTS', () => {
    expect(mediaShouldStartTts('RESUME')).toBe(false)
    expect(mediaShouldStartTts('IGNORE')).toBe(false)
    expect(mediaShouldStartTts('RELEASE_AND_STOP_TTS')).toBe(false)
  })
})
