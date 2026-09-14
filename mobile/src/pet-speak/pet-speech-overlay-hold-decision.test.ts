import { describe, expect, it } from 'vitest'
import { persistNotificationPlan } from './pet-speech-persist-write-decision'
import {
  ACTION_HOLD_SESSION,
  overlayMayStartOrHoldForeground,
  keepWhenNoHostNeverStartsForeground,
  visibilityReceiverMayStartMediaPlaybackForeground,
  visibilityReceiverNeverStartsMediaPlaybackForeground,
  visibilityReceiverNeverStartsTts,
  overlayPermissionDeniedStillSpeaksViaFgs,
  persistOnOverlayBootCompletedNeverStartsFgs,
  persistOffOverlayBootCompletedNeverStartsFgs,
  persistOnOverlayBootCompletedResumeChipTapDoesNotStartTts,
  persistOffOverlayBootCompletedResumeChipTapDoesNotStartTts,
  overlayVisibilityHoldNeverStartsForeground,
  persistOnOverlayVisibilityHoldNeverStartsForeground,
  persistOnSessionHeldOverlayNeverFgsMediaStyleOnly,
  resumeChipOverlayNeverStartsForeground,
  persistOffOverlayAfterKeepHoldPauseNeverHoldsSession,
  persistOffOverlayAfterKeepHoldPauseNeverStartsForeground,
  persistOnOverlayAfterKeepHoldPauseNeverStartsForeground,
  persistOnOverlayAfterKeepHoldPausePausePlanDoesNotShowFgs,
  persistOnOverlayAfterKeepHoldPauseJsReleasePlanDoesNotShowFgs,
  persistOffOverlayAfterKeepHoldPauseServiceAction
} from './pet-speech-overlay-hold-decision'
import {
  decidePetVoiceHoldAction,
  persistOnOverlayJsReleaseEvaluateDoesNotReacquire,
  type PetVoiceHoldState
} from './pet-voice-hold-decision'

const idleAfterPause: PetVoiceHoldState = {
  isSessionHeld: false,
  isAcquiring: false,
  reconnectingSince: null,
  lastNotificationText: null
}

describe('persist-off overlay after Pause-after-keepHold', () => {
  it('never starts or holds foreground', () => {
    expect(overlayMayStartOrHoldForeground()).toBe(false)
    expect(persistOffOverlayAfterKeepHoldPauseNeverStartsForeground(false, true, true)).toBe(true)
    expect(persistOffOverlayAfterKeepHoldPauseNeverStartsForeground(true, true, true)).toBe(false)
  })

  it('persist-on overlay after Pause-after-keepHold still never starts FGS', () => {
    expect(overlayMayStartOrHoldForeground()).toBe(false)
    expect(persistOnOverlayAfterKeepHoldPauseNeverStartsForeground(true, true, true, true)).toBe(
      true
    )
    expect(persistOnOverlayAfterKeepHoldPauseNeverStartsForeground(false, true, true, true)).toBe(
      false
    )
    expect(persistOnOverlayAfterKeepHoldPauseNeverStartsForeground(true, false, true, true)).toBe(
      false
    )
    expect(persistOnOverlayAfterKeepHoldPauseNeverStartsForeground(true, true, false, true)).toBe(
      false
    )
    expect(persistOnOverlayAfterKeepHoldPauseNeverStartsForeground(true, true, true, false)).toBe(
      false
    )
    expect(persistOnOverlayAfterKeepHoldPausePausePlanDoesNotShowFgs(true, true, true, true)).toBe(
      true
    )
    expect(persistOnOverlayAfterKeepHoldPausePausePlanDoesNotShowFgs(false, true, true, true)).toBe(
      false
    )
    expect(persistNotificationPlan('PAUSE').showFgs).toBe(false)
    expect(
      persistOnOverlayAfterKeepHoldPauseJsReleasePlanDoesNotShowFgs(true, true, true, true)
    ).toBe(true)
    expect(
      persistOnOverlayAfterKeepHoldPauseJsReleasePlanDoesNotShowFgs(true, true, true, false)
    ).toBe(false)
    expect(persistNotificationPlan('JS_RELEASE').showFgs).toBe(false)
  })
})

describe('keepWhenNoHost never starts FGS from the visibility receiver', () => {
  it('keepWhenNoHost on still never starts foreground', () => {
    expect(keepWhenNoHostNeverStartsForeground(true)).toBe(false)
    expect(keepWhenNoHostNeverStartsForeground(false)).toBe(false)
    expect(overlayMayStartOrHoldForeground()).toBe(false)
  })
})

describe('visibility receiver never starts mediaPlayback foreground', () => {
  it('mayStartMediaPlayback from visibility receiver is always false', () => {
    expect(visibilityReceiverMayStartMediaPlaybackForeground()).toBe(false)
    expect(overlayMayStartOrHoldForeground()).toBe(false)
    expect(visibilityReceiverNeverStartsMediaPlaybackForeground(true, true)).toBe(true)
    expect(visibilityReceiverNeverStartsMediaPlaybackForeground(false, false)).toBe(true)
    expect(visibilityReceiverNeverStartsMediaPlaybackForeground(true, false)).toBe(true)
  })
})

describe('visibility receiver never starts TTS', () => {
  it('Home/screen-off/lock never start TTS and overlay never FGS', () => {
    expect(visibilityReceiverNeverStartsTts()).toBe(true)
    expect(overlayMayStartOrHoldForeground()).toBe(false)
  })
})

describe('overlay permission deny still speaks via FGS', () => {
  it('denied overlay still never starts FGS and still speaks', () => {
    expect(overlayMayStartOrHoldForeground()).toBe(false)
    expect(overlayPermissionDeniedStillSpeaksViaFgs(true, false)).toBe(true)
    expect(overlayPermissionDeniedStillSpeaksViaFgs(true, true)).toBe(false)
    expect(overlayPermissionDeniedStillSpeaksViaFgs(false, false)).toBe(false)
    expect(overlayPermissionDeniedStillSpeaksViaFgs(false, true)).toBe(false)
  })
})

describe('persist-on overlay BOOT_COMPLETED still never starts FGS', () => {
  it('overlay-while-speaking on boot still posts chip only and never starts FGS', () => {
    expect(persistOnOverlayBootCompletedNeverStartsFgs(true, true, true)).toBe(true)
    expect(persistOnOverlayBootCompletedNeverStartsFgs(true, true, false)).toBe(false)
    expect(persistOnOverlayBootCompletedNeverStartsFgs(false, true, true)).toBe(false)
    expect(persistOnOverlayBootCompletedNeverStartsFgs(true, false, true)).toBe(false)
    expect(overlayMayStartOrHoldForeground()).toBe(false)
    expect(persistOnOverlayBootCompletedResumeChipTapDoesNotStartTts(true, true, true)).toBe(true)
    expect(persistOnOverlayBootCompletedResumeChipTapDoesNotStartTts(true, true, false)).toBe(false)
  })
})

describe('persist-off overlay BOOT_COMPLETED still never starts FGS', () => {
  it('overlay-while-speaking with persist off posts no chip and never starts FGS', () => {
    expect(persistOffOverlayBootCompletedNeverStartsFgs(false, true, true)).toBe(true)
    expect(persistOffOverlayBootCompletedNeverStartsFgs(true, true, true)).toBe(false)
    expect(persistOffOverlayBootCompletedNeverStartsFgs(false, true, false)).toBe(false)
    expect(persistOffOverlayBootCompletedNeverStartsFgs(false, false, true)).toBe(false)
    expect(overlayMayStartOrHoldForeground()).toBe(false)
    expect(persistOffOverlayBootCompletedResumeChipTapDoesNotStartTts(false, true, true)).toBe(true)
    expect(persistOffOverlayBootCompletedResumeChipTapDoesNotStartTts(true, true, true)).toBe(false)
  })
})

describe('overlay visibility hold never starts FGS', () => {
  it('overlay-while-speaking on Home/screen-off/lock still never starts FGS', () => {
    expect(overlayVisibilityHoldNeverStartsForeground(true)).toBe(true)
    expect(overlayVisibilityHoldNeverStartsForeground(false)).toBe(false)
    expect(overlayMayStartOrHoldForeground()).toBe(false)
    expect(persistOnOverlayVisibilityHoldNeverStartsForeground(true, true, true, true)).toBe(true)
    expect(persistOnOverlayVisibilityHoldNeverStartsForeground(true, true, false, true)).toBe(false)
    expect(persistOnOverlayVisibilityHoldNeverStartsForeground(false, true, true, true)).toBe(false)
  })
})

describe('persist-on session-held FGS is MediaStyle only, overlay never FGS', () => {
  it('uses FGS id 4040 never Headuck row 4041, even with overlay-while-speaking', () => {
    expect(persistOnSessionHeldOverlayNeverFgsMediaStyleOnly(true, true, true, true)).toBe(true)
    expect(persistOnSessionHeldOverlayNeverFgsMediaStyleOnly(true, true, true, false)).toBe(true)
    expect(persistOnSessionHeldOverlayNeverFgsMediaStyleOnly(false, true, true, true)).toBe(false)
    expect(persistOnSessionHeldOverlayNeverFgsMediaStyleOnly(true, true, false, true)).toBe(false)
    expect(overlayMayStartOrHoldForeground()).toBe(false)
  })
})

describe('resume-chip notify id 4042 never starts FGS', () => {
  it('chip id is not startForeground even with overlay-while-speaking', () => {
    expect(resumeChipOverlayNeverStartsForeground(true)).toBe(true)
    expect(resumeChipOverlayNeverStartsForeground(false)).toBe(true)
    expect(overlayMayStartOrHoldForeground()).toBe(false)
  })
})

describe('persist-off overlay after Pause-after-keepHold', () => {
  it('never fires ACTION_HOLD_SESSION for chip, play, or JS hold', () => {
    expect(persistOffOverlayAfterKeepHoldPauseNeverHoldsSession(false, true, true)).toBe(true)
    expect(
      persistOffOverlayAfterKeepHoldPauseServiceAction(false, true, true, 'resume-chip')
    ).toBeNull()
    expect(
      persistOffOverlayAfterKeepHoldPauseServiceAction(false, true, true, 'media-play-after-pause')
    ).toBeNull()
    expect(
      persistOffOverlayAfterKeepHoldPauseServiceAction(false, true, true, 'js-hold')
    ).toBeNull()
    expect(persistOffOverlayAfterKeepHoldPauseServiceAction(false, true, true, 'js-hold')).not.toBe(
      ACTION_HOLD_SESSION
    )
  })

  it('does not acquire when a host is connected or still trying', () => {
    const connected = decidePetVoiceHoldAction({
      state: idleAfterPause,
      connectedCount: 1,
      reconnectingCount: 0,
      now: 5000,
      persistEnabled: false,
      overlayWhileSpeaking: true,
      afterKeepHoldPause: true
    })
    expect(connected.type).toBe('none')
    expect(connected.nextState.isSessionHeld).toBe(false)
    const stillTrying = decidePetVoiceHoldAction({
      state: idleAfterPause,
      connectedCount: 0,
      reconnectingCount: 0,
      stillTryingCount: 1,
      now: 5000,
      persistEnabled: false,
      overlayWhileSpeaking: true,
      afterKeepHoldPause: true
    })
    expect(stillTrying.type).toBe('none')
    expect(stillTrying.nextState.isSessionHeld).toBe(false)
  })

  it('persist-on overlay after Pause-after-keepHold still acquires when a host is connected', () => {
    expect(persistOffOverlayAfterKeepHoldPauseNeverHoldsSession(true, true, true)).toBe(false)
    const connected = decidePetVoiceHoldAction({
      state: idleAfterPause,
      connectedCount: 1,
      reconnectingCount: 0,
      now: 5000,
      persistEnabled: true,
      overlayWhileSpeaking: true,
      afterKeepHoldPause: true
    })
    expect(connected.type).toBe('acquire')
    expect(persistOffOverlayAfterKeepHoldPauseServiceAction(true, true, true, 'resume-chip')).toBe(
      ACTION_HOLD_SESSION
    )
  })
})

describe('persist-on overlay JS release evaluate after Pause-after-keepHold', () => {
  it('does not reacquire when idle with no host', () => {
    expect(persistOnOverlayJsReleaseEvaluateDoesNotReacquire(true, true, true, false)).toBe(true)
    const idle = decidePetVoiceHoldAction({
      state: idleAfterPause,
      connectedCount: 0,
      reconnectingCount: 0,
      now: 5000,
      persistEnabled: true,
      overlayWhileSpeaking: true,
      afterKeepHoldPause: true
    })
    expect(idle.type).toBe('none')
    expect(idle.nextState.isSessionHeld).toBe(false)
    const stillTrying = decidePetVoiceHoldAction({
      state: idleAfterPause,
      connectedCount: 0,
      reconnectingCount: 0,
      stillTryingCount: 1,
      now: 6000,
      persistEnabled: true,
      overlayWhileSpeaking: true,
      afterKeepHoldPause: true
    })
    expect(stillTrying.type).toBe('acquire')
    const reconnecting = decidePetVoiceHoldAction({
      state: idleAfterPause,
      connectedCount: 0,
      reconnectingCount: 1,
      now: 7000,
      persistEnabled: true,
      overlayWhileSpeaking: true,
      afterKeepHoldPause: true
    })
    expect(reconnecting.type).toBe('acquire')
    expect(persistOnOverlayJsReleaseEvaluateDoesNotReacquire(true, true, true, false)).toBe(true)
    const keepHostIdle = decidePetVoiceHoldAction({
      state: idleAfterPause,
      connectedCount: 0,
      reconnectingCount: 0,
      now: 8000,
      persistEnabled: true,
      keepWhenNoHost: true,
      overlayWhileSpeaking: true,
      afterKeepHoldPause: true
    })
    expect(keepHostIdle.type).toBe('none')
    expect(keepHostIdle.nextState.isSessionHeld).toBe(false)
    const keepHostTrying = decidePetVoiceHoldAction({
      state: idleAfterPause,
      connectedCount: 0,
      reconnectingCount: 0,
      stillTryingCount: 1,
      now: 9000,
      persistEnabled: true,
      keepWhenNoHost: true,
      overlayWhileSpeaking: true,
      afterKeepHoldPause: true
    })
    expect(keepHostTrying.type).toBe('acquire')
    const keepHostReconnecting = decidePetVoiceHoldAction({
      state: idleAfterPause,
      connectedCount: 0,
      reconnectingCount: 1,
      now: 10000,
      persistEnabled: true,
      keepWhenNoHost: true,
      overlayWhileSpeaking: true,
      afterKeepHoldPause: true
    })
    expect(keepHostReconnecting.type).toBe('acquire')
    const persistOffTrying = decidePetVoiceHoldAction({
      state: idleAfterPause,
      connectedCount: 0,
      reconnectingCount: 0,
      stillTryingCount: 1,
      now: 11000,
      persistEnabled: false,
      keepWhenNoHost: true,
      overlayWhileSpeaking: true,
      afterKeepHoldPause: true
    })
    expect(persistOffTrying.type).toBe('none')
    expect(persistOffTrying.nextState.isSessionHeld).toBe(false)
  })
})
