import { describe, expect, it } from 'vitest'
import {
  persistNotificationAfterMasterOff,
  persistNotificationPlan,
  persistWriteContract,
  persistWriteReleaseReason
} from './pet-speech-persist-write-decision'
import {
  ACTION_HOLD_SESSION,
  overlayMayStartOrHoldForeground,
  persistOffOverlayAfterKeepHoldPauseServiceAction,
  persistOffOverlayJsReleaseEvaluateKeepWhenNoHostConnectedStaysNone,
  persistOffOverlayJsReleaseEvaluateKeepWhenNoHostLeftoverHeldIdleAcquiringReleases,
  persistOffOverlayJsReleaseLeftoverHeldIdleAcquiringCancelsAll,
  persistOffOverlayLeftoverHeldIdleAcquiringMasterOffHidesAll,
  persistOffOverlayLeftoverHeldIdleAcquiringMasterOffHoldSourcesAreNull,
  persistOffOverlayLeftoverHeldIdleAcquiringMasterOffJsHoldActionIsNull,
  persistOffOverlayLeftoverHeldIdleAcquiringMasterOffKeepHostOffHidesAll,
  persistOffOverlayLeftoverHeldIdleAcquiringMasterOffKeepHostOffJsHoldActionIsNull,
  persistOffOverlayLeftoverHeldIdleAcquiringReleases,
  persistOffOverlayLeftoverHeldIdleAcquiringPersistOffStopCancelsAll,
  persistOnOverlayLeftoverHeldIdleAcquiringMasterOffHidesAll,
  persistOnOverlayLeftoverHeldIdleAcquiringMasterOffKeepHostOffReleasesWhileSourcesHold,
  persistOnOverlayLeftoverHeldIdleAcquiringMasterOffKeepHostOnStaysHeldWhileSourcesHold,
  persistOnOverlayLeftoverHeldIdleAcquiringMasterOffHoldSourcesStillHold,
  persistOnOverlayLeftoverHeldIdleAcquiringMasterOffJsHoldStillHolds,
  persistOffOverlayJsReleaseEvaluateKeepWhenNoHostReconnectingStaysNone
} from './pet-speech-overlay-hold-decision'
import {
  decidePetVoiceHoldAction,
  PET_VOICE_RECONNECT_GRACE_MS,
  type PetVoiceHoldState
} from './pet-voice-hold-decision'

const idleAfterPause: PetVoiceHoldState = {
  isSessionHeld: false,
  isAcquiring: false,
  reconnectingSince: null,
  lastNotificationText: null
}

describe('persist-off overlay JS release evaluate keepWhenNoHost after Pause-after-keepHold', () => {
  it('reconnecting still none', () => {
    expect(
      persistOffOverlayJsReleaseEvaluateKeepWhenNoHostReconnectingStaysNone(
        false,
        true,
        true,
        true,
        false
      )
    ).toBe(true)
    expect(
      persistOffOverlayJsReleaseEvaluateKeepWhenNoHostReconnectingStaysNone(
        true,
        true,
        true,
        true,
        false
      )
    ).toBe(false)
    const reconnecting = decidePetVoiceHoldAction({
      state: idleAfterPause,
      connectedCount: 0,
      reconnectingCount: 1,
      now: 12000,
      persistEnabled: false,
      keepWhenNoHost: true,
      overlayWhileSpeaking: true,
      afterKeepHoldPause: true
    })
    expect(reconnecting.type).toBe('none')
    expect(reconnecting.nextState.isSessionHeld).toBe(false)
    expect(reconnecting.nextState.isAcquiring).toBe(false)
  })

  it('connected host still none', () => {
    expect(
      persistOffOverlayJsReleaseEvaluateKeepWhenNoHostConnectedStaysNone(
        false,
        true,
        true,
        true,
        false
      )
    ).toBe(true)
    const connected = decidePetVoiceHoldAction({
      state: idleAfterPause,
      connectedCount: 1,
      reconnectingCount: 0,
      now: 13000,
      persistEnabled: false,
      keepWhenNoHost: true,
      overlayWhileSpeaking: true,
      afterKeepHoldPause: true
    })
    expect(connected.type).toBe('none')
    expect(connected.nextState.isSessionHeld).toBe(false)
    expect(connected.nextState.isAcquiring).toBe(false)
  })

  it('reconnecting plus stillTrying still none', () => {
    const both = decidePetVoiceHoldAction({
      state: idleAfterPause,
      connectedCount: 0,
      reconnectingCount: 1,
      stillTryingCount: 2,
      now: 15000,
      persistEnabled: false,
      keepWhenNoHost: true,
      overlayWhileSpeaking: true,
      afterKeepHoldPause: true
    })
    expect(both.type).toBe('none')
    expect(both.nextState.isSessionHeld).toBe(false)
  })

  it('reconnecting while already acquiring still none', () => {
    const acquiring: PetVoiceHoldState = {
      ...idleAfterPause,
      isAcquiring: true
    }
    const action = decidePetVoiceHoldAction({
      state: acquiring,
      connectedCount: 0,
      reconnectingCount: 1,
      now: 16000,
      persistEnabled: false,
      keepWhenNoHost: true,
      overlayWhileSpeaking: true,
      afterKeepHoldPause: true
    })
    expect(action.type).toBe('none')
    expect(action.nextState.isSessionHeld).toBe(false)
    expect(action.nextState.isAcquiring).toBe(true)
  })

  it('reconnecting while leftover held does not acquire', () => {
    const leftoverHeld: PetVoiceHoldState = {
      isSessionHeld: true,
      isAcquiring: false,
      reconnectingSince: null,
      lastNotificationText: 'Pet voice connected'
    }
    const action = decidePetVoiceHoldAction({
      state: leftoverHeld,
      connectedCount: 0,
      reconnectingCount: 1,
      now: 17000,
      persistEnabled: false,
      keepWhenNoHost: true,
      overlayWhileSpeaking: true,
      afterKeepHoldPause: true
    })
    expect(action.type).toBe('update-notification')
    expect(action.type).not.toBe('acquire')
    expect(action.nextState.isAcquiring).not.toBe(true)
    expect(action.nextState.isSessionHeld).toBe(true)
    const pastGrace = decidePetVoiceHoldAction({
      state: {
        ...leftoverHeld,
        reconnectingSince: 0,
        lastNotificationText: 'Orca Pet — Reconnecting...'
      },
      connectedCount: 0,
      reconnectingCount: 1,
      now: PET_VOICE_RECONNECT_GRACE_MS,
      persistEnabled: false,
      keepWhenNoHost: true,
      overlayWhileSpeaking: true,
      afterKeepHoldPause: true
    })
    expect(pastGrace.type).toBe('release')
    expect(pastGrace.nextState.isSessionHeld).toBe(false)
    expect(pastGrace.nextState.isAcquiring).toBe(false)
    const leftoverIdle = decidePetVoiceHoldAction({
      state: leftoverHeld,
      connectedCount: 0,
      reconnectingCount: 0,
      now: 18000,
      persistEnabled: false,
      keepWhenNoHost: true,
      overlayWhileSpeaking: true,
      afterKeepHoldPause: true
    })
    expect(leftoverIdle.type).toBe('release')
    expect(leftoverIdle.nextState.isSessionHeld).toBe(false)
    const alreadyReconnecting = decidePetVoiceHoldAction({
      state: {
        ...leftoverHeld,
        reconnectingSince: 17000,
        lastNotificationText: 'Orca Pet — Reconnecting...'
      },
      connectedCount: 0,
      reconnectingCount: 1,
      now: 18000,
      persistEnabled: false,
      keepWhenNoHost: true,
      overlayWhileSpeaking: true,
      afterKeepHoldPause: true
    })
    expect(alreadyReconnecting.type).toBe('none')
    expect(alreadyReconnecting.nextState.isSessionHeld).toBe(true)
    expect(alreadyReconnecting.nextState.isAcquiring).toBe(false)
    const leftoverConnected = decidePetVoiceHoldAction({
      state: leftoverHeld,
      connectedCount: 1,
      reconnectingCount: 0,
      now: 19000,
      persistEnabled: false,
      keepWhenNoHost: true,
      overlayWhileSpeaking: true,
      afterKeepHoldPause: true
    })
    expect(leftoverConnected.type).toBe('none')
    expect(leftoverConnected.nextState.isSessionHeld).toBe(true)
    expect(leftoverConnected.nextState.isAcquiring).toBe(false)
    const leftoverConnectedStaleText = decidePetVoiceHoldAction({
      state: {
        ...leftoverHeld,
        lastNotificationText: 'Orca Pet — Reconnecting...'
      },
      connectedCount: 1,
      reconnectingCount: 0,
      now: 20000,
      persistEnabled: false,
      keepWhenNoHost: true,
      overlayWhileSpeaking: true,
      afterKeepHoldPause: true
    })
    expect(leftoverConnectedStaleText.type).toBe('update-notification')
    expect(leftoverConnectedStaleText.type).not.toBe('acquire')
    expect(leftoverConnectedStaleText.nextState.isSessionHeld).toBe(true)
    const leftoverConnectedClearsReconnect = decidePetVoiceHoldAction({
      state: {
        ...leftoverHeld,
        reconnectingSince: 5000,
        lastNotificationText: 'Pet voice connected'
      },
      connectedCount: 1,
      reconnectingCount: 0,
      now: 21000,
      persistEnabled: false,
      keepWhenNoHost: true,
      overlayWhileSpeaking: true,
      afterKeepHoldPause: true
    })
    expect(leftoverConnectedClearsReconnect.type).toBe('none')
    expect(leftoverConnectedClearsReconnect.nextState.reconnectingSince).toBeNull()
    expect(leftoverConnectedClearsReconnect.nextState.isSessionHeld).toBe(true)
    expect(leftoverConnectedClearsReconnect.nextState.isAcquiring).toBe(false)
    const leftoverHeldAcquiring = decidePetVoiceHoldAction({
      state: {
        ...leftoverHeld,
        isAcquiring: true
      },
      connectedCount: 1,
      reconnectingCount: 0,
      now: 22000,
      persistEnabled: false,
      keepWhenNoHost: true,
      overlayWhileSpeaking: true,
      afterKeepHoldPause: true
    })
    expect(leftoverHeldAcquiring.type).toBe('none')
    expect(leftoverHeldAcquiring.nextState.isSessionHeld).toBe(true)
    expect(leftoverHeldAcquiring.nextState.isAcquiring).toBe(true)
  })

  it('leftover held idle while isAcquiring still releases', () => {
    expect(
      persistOffOverlayJsReleaseEvaluateKeepWhenNoHostLeftoverHeldIdleAcquiringReleases(
        false,
        true,
        true,
        true,
        true,
        true
      )
    ).toBe(true)
    expect(
      persistOffOverlayJsReleaseEvaluateKeepWhenNoHostLeftoverHeldIdleAcquiringReleases(
        true,
        true,
        true,
        true,
        true,
        true
      )
    ).toBe(false)
    const leftoverHeldAcquiringIdle: PetVoiceHoldState = {
      isSessionHeld: true,
      isAcquiring: true,
      reconnectingSince: null,
      lastNotificationText: 'Pet voice connected'
    }
    const action = decidePetVoiceHoldAction({
      state: leftoverHeldAcquiringIdle,
      connectedCount: 0,
      reconnectingCount: 0,
      now: 23000,
      persistEnabled: false,
      keepWhenNoHost: true,
      overlayWhileSpeaking: true,
      afterKeepHoldPause: true
    })
    expect(action.type).toBe('release')
    expect(action.nextState.isSessionHeld).toBe(false)
    expect(action.nextState.isAcquiring).toBe(false)
    expect(action.nextState.reconnectingSince).toBeNull()
    expect(action.nextState.lastNotificationText).toBeNull()
    const withReconnectStamp = decidePetVoiceHoldAction({
      state: {
        ...leftoverHeldAcquiringIdle,
        reconnectingSince: 1000,
        lastNotificationText: 'Orca Pet — Reconnecting...'
      },
      connectedCount: 0,
      reconnectingCount: 0,
      now: 24000,
      persistEnabled: false,
      keepWhenNoHost: true,
      overlayWhileSpeaking: true,
      afterKeepHoldPause: true
    })
    expect(withReconnectStamp.type).toBe('release')
    expect(withReconnectStamp.nextState.isSessionHeld).toBe(false)
    expect(withReconnectStamp.nextState.isAcquiring).toBe(false)
    const keepHostOff = decidePetVoiceHoldAction({
      state: leftoverHeldAcquiringIdle,
      connectedCount: 0,
      reconnectingCount: 0,
      now: 25000,
      persistEnabled: false,
      keepWhenNoHost: false,
      overlayWhileSpeaking: true,
      afterKeepHoldPause: true
    })
    expect(keepHostOff.type).toBe('release')
    expect(keepHostOff.nextState.isSessionHeld).toBe(false)
    const persistOnKeepHost = decidePetVoiceHoldAction({
      state: leftoverHeldAcquiringIdle,
      connectedCount: 0,
      reconnectingCount: 0,
      now: 26000,
      persistEnabled: true,
      keepWhenNoHost: true,
      overlayWhileSpeaking: true,
      afterKeepHoldPause: true
    })
    expect(persistOnKeepHost.type).toBe('none')
    expect(persistOnKeepHost.nextState.isSessionHeld).toBe(true)
    const persistOnKeepHostOff = decidePetVoiceHoldAction({
      state: leftoverHeldAcquiringIdle,
      connectedCount: 0,
      reconnectingCount: 0,
      now: 27000,
      persistEnabled: true,
      keepWhenNoHost: false,
      overlayWhileSpeaking: true,
      afterKeepHoldPause: true
    })
    expect(persistOnKeepHostOff.type).toBe('release')
    expect(persistOnKeepHostOff.nextState.isSessionHeld).toBe(false)
    expect(persistOnKeepHostOff.nextState.isAcquiring).toBe(false)
    const blankChip = decidePetVoiceHoldAction({
      state: {
        ...leftoverHeldAcquiringIdle,
        lastNotificationText: null
      },
      connectedCount: 0,
      reconnectingCount: 0,
      now: 28000,
      persistEnabled: false,
      keepWhenNoHost: true,
      overlayWhileSpeaking: true,
      afterKeepHoldPause: true
    })
    expect(blankChip.type).toBe('release')
    expect(blankChip.nextState.isSessionHeld).toBe(false)
    expect(
      persistOffOverlayAfterKeepHoldPauseServiceAction(false, true, true, 'js-hold')
    ).toBeNull()
    expect(overlayMayStartOrHoldForeground()).toBe(false)
    expect(
      persistOffOverlayJsReleaseLeftoverHeldIdleAcquiringCancelsAll(
        false,
        true,
        true,
        true,
        true,
        true
      )
    ).toBe(true)
    expect(
      persistOffOverlayLeftoverHeldIdleAcquiringPersistOffStopCancelsAll(
        false,
        true,
        true,
        true,
        true,
        true
      )
    ).toBe(true)
    expect(persistNotificationPlan('JS_RELEASE')).toEqual({
      showFgs: false,
      showServiceRow: false,
      showResumeChip: false
    })
    expect(persistNotificationPlan('PERSIST_OFF_STOP')).toEqual({
      showFgs: false,
      showServiceRow: false,
      showResumeChip: false
    })
  })

  it('leftover held idle acquiring MASTER_OFF notification plan still hide all', () => {
    expect(
      persistOffOverlayLeftoverHeldIdleAcquiringMasterOffHidesAll(
        false,
        true,
        true,
        true,
        true,
        true,
        false
      )
    ).toBe(true)
    expect(
      persistOffOverlayLeftoverHeldIdleAcquiringMasterOffHidesAll(
        false,
        true,
        true,
        true,
        true,
        true,
        true
      )
    ).toBe(false)
    expect(persistNotificationPlan('MASTER_OFF')).toEqual({
      showFgs: false,
      showServiceRow: false,
      showResumeChip: false
    })
    expect(persistNotificationPlan('MASTER_OFF')).toEqual(persistNotificationPlan('JS_RELEASE'))
    expect(persistNotificationPlan('MASTER_OFF')).toEqual(persistNotificationAfterMasterOff())
    expect(persistWriteReleaseReason(false, false)).toBe('MASTER_OFF')
    expect(persistWriteReleaseReason(true, false)).toBe('MASTER_OFF')
    const masterContract = persistWriteContract('MASTER_OFF')
    expect(masterContract.aftermath).toBe('CANCEL_ALL')
    expect(masterContract.cancelResumeChip).toBe(true)
    expect(masterContract.startTts).toBe(false)
    expect(masterContract.reacquireHold).toBe(false)
    const leftoverHeldAcquiringIdle: PetVoiceHoldState = {
      isSessionHeld: true,
      isAcquiring: true,
      reconnectingSince: null,
      lastNotificationText: 'Pet voice connected'
    }
    const action = decidePetVoiceHoldAction({
      state: leftoverHeldAcquiringIdle,
      connectedCount: 0,
      reconnectingCount: 0,
      now: 29000,
      persistEnabled: false,
      keepWhenNoHost: true,
      overlayWhileSpeaking: true,
      afterKeepHoldPause: true
    })
    expect(action.type).toBe('release')
    expect(action.nextState.isSessionHeld).toBe(false)
    expect(
      persistOnOverlayLeftoverHeldIdleAcquiringMasterOffHidesAll(
        true,
        true,
        true,
        true,
        true,
        true,
        false
      )
    ).toBe(true)
    const persistOnKeepHostMasterOff = decidePetVoiceHoldAction({
      state: leftoverHeldAcquiringIdle,
      connectedCount: 0,
      reconnectingCount: 0,
      now: 30000,
      persistEnabled: true,
      keepWhenNoHost: true,
      overlayWhileSpeaking: true,
      afterKeepHoldPause: true
    })
    expect(persistOnKeepHostMasterOff.type).toBe('none')
    expect(persistOnKeepHostMasterOff.nextState.isSessionHeld).toBe(true)
    const persistOnKeepHostOffMasterOff = decidePetVoiceHoldAction({
      state: leftoverHeldAcquiringIdle,
      connectedCount: 0,
      reconnectingCount: 0,
      now: 31000,
      persistEnabled: true,
      keepWhenNoHost: false,
      overlayWhileSpeaking: true,
      afterKeepHoldPause: true
    })
    expect(persistOnKeepHostOffMasterOff.type).toBe('release')
    expect(persistOnKeepHostOffMasterOff.nextState.isSessionHeld).toBe(false)
    expect(persistOnKeepHostOffMasterOff.nextState.isAcquiring).toBe(false)
    expect(persistNotificationPlan('MASTER_OFF')).toEqual({
      showFgs: false,
      showServiceRow: false,
      showResumeChip: false
    })
  })

  it('leftover held idle acquiring MASTER_OFF js-hold service action still null', () => {
    expect(
      persistOffOverlayLeftoverHeldIdleAcquiringMasterOffJsHoldActionIsNull(
        false,
        true,
        true,
        true,
        true,
        true,
        false
      )
    ).toBe(true)
    expect(
      persistOffOverlayLeftoverHeldIdleAcquiringMasterOffJsHoldActionIsNull(
        false,
        true,
        true,
        true,
        true,
        true,
        true
      )
    ).toBe(false)
    expect(
      persistOffOverlayLeftoverHeldIdleAcquiringMasterOffJsHoldActionIsNull(
        true,
        true,
        true,
        true,
        true,
        true,
        false
      )
    ).toBe(false)
    expect(
      persistOffOverlayAfterKeepHoldPauseServiceAction(false, true, true, 'js-hold')
    ).toBeNull()
    expect(persistOffOverlayAfterKeepHoldPauseServiceAction(false, true, true, 'js-hold')).not.toBe(
      ACTION_HOLD_SESSION
    )
    expect(
      persistOffOverlayLeftoverHeldIdleAcquiringMasterOffHoldSourcesAreNull(false, true, true)
    ).toBe(true)
    expect(
      persistOffOverlayLeftoverHeldIdleAcquiringMasterOffHoldSourcesAreNull(true, true, true)
    ).toBe(false)
    expect(
      persistOnOverlayLeftoverHeldIdleAcquiringMasterOffJsHoldStillHolds(true, true, true)
    ).toBe(true)
    expect(
      persistOnOverlayLeftoverHeldIdleAcquiringMasterOffJsHoldStillHolds(false, true, true)
    ).toBe(false)
    expect(
      persistOnOverlayLeftoverHeldIdleAcquiringMasterOffHoldSourcesStillHold(true, true, true)
    ).toBe(true)
    expect(
      persistOnOverlayLeftoverHeldIdleAcquiringMasterOffHoldSourcesStillHold(false, true, true)
    ).toBe(false)
    expect(
      persistOnOverlayLeftoverHeldIdleAcquiringMasterOffKeepHostOnStaysHeldWhileSourcesHold(
        true,
        true,
        true,
        true,
        true,
        true,
        false
      )
    ).toBe(true)
    expect(
      persistOnOverlayLeftoverHeldIdleAcquiringMasterOffKeepHostOnStaysHeldWhileSourcesHold(
        true,
        false,
        true,
        true,
        true,
        true,
        false
      )
    ).toBe(false)
    expect(overlayMayStartOrHoldForeground()).toBe(false)
    const leftoverHeldAcquiringIdle: PetVoiceHoldState = {
      isSessionHeld: true,
      isAcquiring: true,
      reconnectingSince: null,
      lastNotificationText: 'Pet voice connected'
    }
    const persistOnKeepHostOn = decidePetVoiceHoldAction({
      state: leftoverHeldAcquiringIdle,
      connectedCount: 0,
      reconnectingCount: 0,
      now: 31500,
      persistEnabled: true,
      keepWhenNoHost: true,
      overlayWhileSpeaking: true,
      afterKeepHoldPause: true
    })
    expect(persistOnKeepHostOn.type).toBe('none')
    expect(persistOnKeepHostOn.nextState.isSessionHeld).toBe(true)
    const persistOnKeepHostOff = decidePetVoiceHoldAction({
      state: leftoverHeldAcquiringIdle,
      connectedCount: 0,
      reconnectingCount: 0,
      now: 31750,
      persistEnabled: true,
      keepWhenNoHost: false,
      overlayWhileSpeaking: true,
      afterKeepHoldPause: true
    })
    expect(persistOnKeepHostOff.type).toBe('release')
    expect(persistOnKeepHostOff.nextState.isSessionHeld).toBe(false)
    expect(
      persistOnOverlayLeftoverHeldIdleAcquiringMasterOffKeepHostOffReleasesWhileSourcesHold(
        true,
        false,
        true,
        true,
        true,
        true,
        false
      )
    ).toBe(true)
    expect(
      persistOnOverlayLeftoverHeldIdleAcquiringMasterOffKeepHostOffReleasesWhileSourcesHold(
        true,
        true,
        true,
        true,
        true,
        true,
        false
      )
    ).toBe(false)
    const persistOffKeepHostOff = decidePetVoiceHoldAction({
      state: leftoverHeldAcquiringIdle,
      connectedCount: 0,
      reconnectingCount: 0,
      now: 32000,
      persistEnabled: false,
      keepWhenNoHost: false,
      overlayWhileSpeaking: true,
      afterKeepHoldPause: true
    })
    expect(persistOffKeepHostOff.type).toBe('release')
    expect(persistOffKeepHostOff.nextState.isSessionHeld).toBe(false)
    expect(
      persistOffOverlayAfterKeepHoldPauseServiceAction(false, true, true, 'js-hold')
    ).toBeNull()
    expect(persistOffOverlayLeftoverHeldIdleAcquiringReleases(false, true, true, true, true)).toBe(
      true
    )
    expect(
      persistOffOverlayLeftoverHeldIdleAcquiringMasterOffKeepHostOffHidesAll(
        false,
        false,
        true,
        true,
        true,
        true,
        false
      )
    ).toBe(true)
    expect(
      persistOffOverlayLeftoverHeldIdleAcquiringMasterOffKeepHostOffHidesAll(
        false,
        true,
        true,
        true,
        true,
        true,
        false
      )
    ).toBe(false)
    expect(
      persistOffOverlayLeftoverHeldIdleAcquiringMasterOffKeepHostOffJsHoldActionIsNull(
        false,
        false,
        true,
        true,
        true,
        true,
        false
      )
    ).toBe(true)
    expect(
      persistOffOverlayLeftoverHeldIdleAcquiringMasterOffKeepHostOffJsHoldActionIsNull(
        false,
        true,
        true,
        true,
        true,
        true,
        false
      )
    ).toBe(false)
  })

  it('idle with no host still none', () => {
    const idle = decidePetVoiceHoldAction({
      state: idleAfterPause,
      connectedCount: 0,
      reconnectingCount: 0,
      now: 14000,
      persistEnabled: false,
      keepWhenNoHost: true,
      overlayWhileSpeaking: true,
      afterKeepHoldPause: true
    })
    expect(idle.type).toBe('none')
    expect(idle.nextState.isSessionHeld).toBe(false)
    expect(
      persistOffOverlayJsReleaseEvaluateKeepWhenNoHostReconnectingStaysNone(
        false,
        true,
        true,
        true,
        false
      )
    ).toBe(true)
  })
})
