import {
  bootCompletedNotificationPlan,
  bootCompletedPostsResumeChipOnlyNeverStartsFgs,
  bootCompletedResumeChipTapDoesNotStartTts,
  persistNotificationPlan,
  persistOnSessionHeldFgsIsMediaStyleId4040NeverServiceRow4041,
  resumeChipNotifyIdNeverStartsForeground
} from './pet-speech-persist-write-decision'

export const ACTION_HOLD_SESSION = 'expo.modules.petspeech.ACTION_HOLD_SESSION'
export {
  ACTION_SCREEN_OFF,
  ACTION_USER_PRESENT,
  ACTION_CLOSE_SYSTEM_DIALOGS,
  isVisibilityRetainAction,
  visibilityRetainEventFromAction,
  persistOnSessionHeldVisibilityRetainKeepsMediaStyleFgs
} from './pet-speech-fgs-retain-decision'
export type { VisibilityRetainEvent } from './pet-speech-fgs-retain-decision'

export type OverlayHoldSource = 'resume-chip' | 'media-play-after-pause' | 'play-pause' | 'js-hold'

export function overlayMayStartOrHoldForeground(): boolean {
  return false
}

export function persistOnSessionHeldOverlayNeverFgsMediaStyleOnly(
  persistEnabled: boolean,
  masterEnabled: boolean,
  sessionHeld: boolean,
  overlayWhileSpeaking: boolean
): boolean {
  if (
    !persistOnSessionHeldFgsIsMediaStyleId4040NeverServiceRow4041(
      persistEnabled,
      masterEnabled,
      sessionHeld
    )
  ) {
    return false
  }
  if (overlayWhileSpeaking && overlayMayStartOrHoldForeground()) {
    return false
  }
  return !overlayMayStartOrHoldForeground()
}

export function resumeChipOverlayNeverStartsForeground(overlayWhileSpeaking: boolean): boolean {
  if (overlayWhileSpeaking && overlayMayStartOrHoldForeground()) {
    return false
  }
  return resumeChipNotifyIdNeverStartsForeground() && !overlayMayStartOrHoldForeground()
}

export function keepWhenNoHostNeverStartsForeground(_keepWhenNoHost: boolean): boolean {
  return false
}

export function visibilityReceiverMayStartMediaPlaybackForeground(): boolean {
  return false
}

export function visibilityReceiverNeverStartsMediaPlaybackForeground(
  overlayWhileSpeaking: boolean,
  keepWhenNoHost: boolean
): boolean {
  if (overlayWhileSpeaking && overlayMayStartOrHoldForeground()) {
    return false
  }
  return (
    !visibilityReceiverMayStartMediaPlaybackForeground() &&
    !keepWhenNoHostNeverStartsForeground(keepWhenNoHost) &&
    !overlayMayStartOrHoldForeground()
  )
}

export function visibilityReceiverNeverStartsTts(): boolean {
  return (
    !overlayMayStartOrHoldForeground() &&
    visibilityReceiverMayStartMediaPlaybackForeground() === false
  )
}

export function overlayPermissionDeniedStillSpeaksViaFgs(
  overlayWhileSpeaking: boolean,
  canDrawOverlays: boolean
): boolean {
  return overlayWhileSpeaking && !canDrawOverlays && !overlayMayStartOrHoldForeground()
}

export function persistOnOverlayBootCompletedNeverStartsFgs(
  persistEnabled: boolean,
  masterEnabled: boolean,
  overlayWhileSpeaking: boolean
): boolean {
  return (
    overlayWhileSpeaking &&
    persistEnabled &&
    masterEnabled &&
    !overlayMayStartOrHoldForeground() &&
    bootCompletedPostsResumeChipOnlyNeverStartsFgs(persistEnabled, masterEnabled)
  )
}

export function persistOffOverlayBootCompletedNeverStartsFgs(
  persistEnabled: boolean,
  masterEnabled: boolean,
  overlayWhileSpeaking: boolean
): boolean {
  return (
    overlayWhileSpeaking &&
    !persistEnabled &&
    masterEnabled &&
    !overlayMayStartOrHoldForeground() &&
    bootCompletedPostsResumeChipOnlyNeverStartsFgs(persistEnabled, masterEnabled) &&
    bootCompletedNotificationPlan(persistEnabled, masterEnabled).showResumeChip === false
  )
}

export function persistOnOverlayBootCompletedResumeChipTapDoesNotStartTts(
  persistEnabled: boolean,
  masterEnabled: boolean,
  overlayWhileSpeaking: boolean
): boolean {
  return (
    persistOnOverlayBootCompletedNeverStartsFgs(
      persistEnabled,
      masterEnabled,
      overlayWhileSpeaking
    ) && bootCompletedResumeChipTapDoesNotStartTts(persistEnabled, masterEnabled)
  )
}

export function persistOffOverlayBootCompletedResumeChipTapDoesNotStartTts(
  persistEnabled: boolean,
  masterEnabled: boolean,
  overlayWhileSpeaking: boolean
): boolean {
  return (
    persistOffOverlayBootCompletedNeverStartsFgs(
      persistEnabled,
      masterEnabled,
      overlayWhileSpeaking
    ) && bootCompletedResumeChipTapDoesNotStartTts(persistEnabled, masterEnabled)
  )
}

export function overlayVisibilityHoldNeverStartsForeground(overlayWhileSpeaking: boolean): boolean {
  return overlayWhileSpeaking && !overlayMayStartOrHoldForeground()
}

export function persistOnOverlayVisibilityHoldNeverStartsForeground(
  persistEnabled: boolean,
  masterEnabled: boolean,
  overlayWhileSpeaking: boolean,
  sessionHeld: boolean
): boolean {
  return (
    persistEnabled &&
    masterEnabled &&
    sessionHeld &&
    overlayVisibilityHoldNeverStartsForeground(overlayWhileSpeaking)
  )
}

export function persistOffOverlayAfterKeepHoldPauseNeverStartsForeground(
  persistEnabled: boolean,
  overlayWhileSpeaking: boolean,
  afterKeepHoldPause: boolean
): boolean {
  return (
    afterKeepHoldPause &&
    !persistEnabled &&
    overlayWhileSpeaking &&
    !overlayMayStartOrHoldForeground()
  )
}

export function persistOnOverlayAfterKeepHoldPauseNeverStartsForeground(
  persistEnabled: boolean,
  overlayWhileSpeaking: boolean,
  afterKeepHoldPause: boolean,
  masterEnabled: boolean
): boolean {
  return (
    afterKeepHoldPause &&
    persistEnabled &&
    overlayWhileSpeaking &&
    masterEnabled &&
    !overlayMayStartOrHoldForeground()
  )
}

export function persistOnOverlayAfterKeepHoldPausePausePlanDoesNotShowFgs(
  persistEnabled: boolean,
  overlayWhileSpeaking: boolean,
  afterKeepHoldPause: boolean,
  masterEnabled: boolean
): boolean {
  if (
    !persistOnOverlayAfterKeepHoldPauseNeverStartsForeground(
      persistEnabled,
      overlayWhileSpeaking,
      afterKeepHoldPause,
      masterEnabled
    )
  ) {
    return false
  }
  return persistNotificationPlan('PAUSE').showFgs === false
}

export function persistOnOverlayAfterKeepHoldPauseJsReleasePlanDoesNotShowFgs(
  persistEnabled: boolean,
  overlayWhileSpeaking: boolean,
  afterKeepHoldPause: boolean,
  masterEnabled: boolean
): boolean {
  if (
    !persistOnOverlayAfterKeepHoldPauseNeverStartsForeground(
      persistEnabled,
      overlayWhileSpeaking,
      afterKeepHoldPause,
      masterEnabled
    )
  ) {
    return false
  }
  return persistNotificationPlan('JS_RELEASE').showFgs === false
}

export function persistOffOverlayAfterKeepHoldPauseNeverHoldsSession(
  persistEnabled: boolean,
  overlayWhileSpeaking: boolean,
  afterKeepHoldPause: boolean
): boolean {
  return afterKeepHoldPause && !persistEnabled && overlayWhileSpeaking
}

export function persistOffOverlayJsReleaseEvaluateKeepWhenNoHostReconnectingStaysNone(
  persistEnabled: boolean,
  keepWhenNoHost: boolean,
  overlayWhileSpeaking: boolean,
  afterKeepHoldPause: boolean,
  sessionHeld: boolean
): boolean {
  return (
    persistOffOverlayAfterKeepHoldPauseNeverHoldsSession(
      persistEnabled,
      overlayWhileSpeaking,
      afterKeepHoldPause
    ) &&
    keepWhenNoHost &&
    !sessionHeld
  )
}

export function persistOffOverlayAfterKeepHoldPauseServiceAction(
  persistEnabled: boolean,
  overlayWhileSpeaking: boolean,
  afterKeepHoldPause: boolean,
  source: OverlayHoldSource
): string | null {
  if (
    persistOffOverlayAfterKeepHoldPauseNeverHoldsSession(
      persistEnabled,
      overlayWhileSpeaking,
      afterKeepHoldPause
    )
  ) {
    return null
  }
  if (source === 'resume-chip' || source === 'media-play-after-pause' || source === 'play-pause') {
    return persistEnabled ? ACTION_HOLD_SESSION : null
  }
  return ACTION_HOLD_SESSION
}
