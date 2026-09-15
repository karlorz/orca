import { describe, expect, it } from 'vitest'
import {
  nextPauseLatched,
  pauseLatchAllowsHold,
  pauseLatchRefusesSpeak
} from './pet-speech-pause-latch'

describe('pause latch refuses new TTS until resume chip', () => {
  it('pause latches and refuses speak until resume chip or media play-after-pause', () => {
    expect(pauseLatchRefusesSpeak(false)).toBe(false)
    const afterPause = nextPauseLatched(false, 'pause')
    expect(afterPause).toBe(true)
    expect(pauseLatchRefusesSpeak(afterPause)).toBe(true)
    expect(pauseLatchAllowsHold(afterPause, 'js-hold')).toBe(false)
    expect(pauseLatchAllowsHold(afterPause, 'resume-chip')).toBe(true)
    expect(nextPauseLatched(afterPause, 'resume-chip')).toBe(false)
    expect(nextPauseLatched(afterPause, 'media-play-after-pause')).toBe(false)
  })

  it('master-off and js-release cancel the latch', () => {
    expect(nextPauseLatched(true, 'master-off')).toBe(false)
    expect(nextPauseLatched(true, 'js-release')).toBe(false)
    expect(nextPauseLatched(true, 'persist-off-stop')).toBe(false)
    expect(pauseLatchRefusesSpeak(false)).toBe(false)
  })
})
