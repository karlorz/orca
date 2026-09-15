import {
  ACTION_HOLD_SESSION,
  overlayMayStartOrHoldForeground,
  persistOffOverlayAfterKeepHoldPauseServiceAction,
  type OverlayHoldSource
} from './pet-speech-overlay-hold-core'
import {
  persistOffOverlayLeftoverHeldIdleAcquiringMasterOffHidesAll,
  persistOnOverlayLeftoverHeldIdleAcquiringMasterOffHidesAll
} from './pet-speech-overlay-hold-leftover'

export function persistOffOverlayLeftoverHeldIdleAcquiringMasterOffJsHoldActionIsNull(
  persistEnabled: boolean,
  keepWhenNoHost: boolean,
  overlayWhileSpeaking: boolean,
  afterKeepHoldPause: boolean,
  sessionHeld: boolean,
  isAcquiring: boolean,
  masterEnabled: boolean
): boolean {
  if (
    !persistOffOverlayLeftoverHeldIdleAcquiringMasterOffHidesAll(
      persistEnabled,
      keepWhenNoHost,
      overlayWhileSpeaking,
      afterKeepHoldPause,
      sessionHeld,
      isAcquiring,
      masterEnabled
    )
  ) {
    return false
  }
  return (
    persistOffOverlayAfterKeepHoldPauseServiceAction(
      persistEnabled,
      overlayWhileSpeaking,
      afterKeepHoldPause,
      'js-hold'
    ) === null && !overlayMayStartOrHoldForeground()
  )
}

export function persistOffOverlayLeftoverHeldIdleAcquiringMasterOffHoldSourcesAreNull(
  persistEnabled: boolean,
  overlayWhileSpeaking: boolean,
  afterKeepHoldPause: boolean
): boolean {
  const sources: OverlayHoldSource[] = [
    'js-hold',
    'resume-chip',
    'media-play-after-pause',
    'play-pause'
  ]
  return sources.every(
    (source) =>
      persistOffOverlayAfterKeepHoldPauseServiceAction(
        persistEnabled,
        overlayWhileSpeaking,
        afterKeepHoldPause,
        source
      ) === null
  )
}

export function persistOnOverlayLeftoverHeldIdleAcquiringMasterOffJsHoldStillHolds(
  persistEnabled: boolean,
  overlayWhileSpeaking: boolean,
  afterKeepHoldPause: boolean
): boolean {
  if (!persistEnabled || !overlayWhileSpeaking || !afterKeepHoldPause) {
    return false
  }
  return (
    persistOffOverlayAfterKeepHoldPauseServiceAction(
      persistEnabled,
      overlayWhileSpeaking,
      afterKeepHoldPause,
      'js-hold'
    ) === ACTION_HOLD_SESSION
  )
}

export function persistOnOverlayLeftoverHeldIdleAcquiringMasterOffKeepHostOffReleasesWhileSourcesHold(
  persistEnabled: boolean,
  keepWhenNoHost: boolean,
  overlayWhileSpeaking: boolean,
  afterKeepHoldPause: boolean,
  sessionHeld: boolean,
  isAcquiring: boolean,
  masterEnabled: boolean
): boolean {
  if (keepWhenNoHost) {
    return false
  }
  if (
    !persistOnOverlayLeftoverHeldIdleAcquiringMasterOffHidesAll(
      persistEnabled,
      keepWhenNoHost,
      overlayWhileSpeaking,
      afterKeepHoldPause,
      sessionHeld,
      isAcquiring,
      masterEnabled
    )
  ) {
    return false
  }
  return persistOnOverlayLeftoverHeldIdleAcquiringMasterOffHoldSourcesStillHold(
    persistEnabled,
    overlayWhileSpeaking,
    afterKeepHoldPause
  )
}

export function persistOnOverlayLeftoverHeldIdleAcquiringMasterOffKeepHostOnStaysHeldWhileSourcesHold(
  persistEnabled: boolean,
  keepWhenNoHost: boolean,
  overlayWhileSpeaking: boolean,
  afterKeepHoldPause: boolean,
  sessionHeld: boolean,
  isAcquiring: boolean,
  masterEnabled: boolean
): boolean {
  if (!keepWhenNoHost) {
    return false
  }
  if (
    !persistOnOverlayLeftoverHeldIdleAcquiringMasterOffHidesAll(
      persistEnabled,
      keepWhenNoHost,
      overlayWhileSpeaking,
      afterKeepHoldPause,
      sessionHeld,
      isAcquiring,
      masterEnabled
    )
  ) {
    return false
  }
  return persistOnOverlayLeftoverHeldIdleAcquiringMasterOffHoldSourcesStillHold(
    persistEnabled,
    overlayWhileSpeaking,
    afterKeepHoldPause
  )
}

export function persistOnOverlayLeftoverHeldIdleAcquiringMasterOffHoldSourcesStillHold(
  persistEnabled: boolean,
  overlayWhileSpeaking: boolean,
  afterKeepHoldPause: boolean
): boolean {
  if (
    !persistOnOverlayLeftoverHeldIdleAcquiringMasterOffJsHoldStillHolds(
      persistEnabled,
      overlayWhileSpeaking,
      afterKeepHoldPause
    )
  ) {
    return false
  }
  const sources: OverlayHoldSource[] = ['resume-chip', 'media-play-after-pause', 'play-pause']
  return sources.every(
    (source) =>
      persistOffOverlayAfterKeepHoldPauseServiceAction(
        persistEnabled,
        overlayWhileSpeaking,
        afterKeepHoldPause,
        source
      ) === ACTION_HOLD_SESSION
  )
}
