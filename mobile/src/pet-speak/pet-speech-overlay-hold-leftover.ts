import {
  persistNotificationPlan,
  persistWriteContract,
  persistWriteReleaseReason
} from './pet-speech-persist-write-decision'
import {
  overlayMayStartOrHoldForeground,
  persistOffOverlayAfterKeepHoldPauseNeverHoldsSession,
  persistOffOverlayAfterKeepHoldPauseServiceAction,
  persistOffOverlayJsReleaseEvaluateKeepWhenNoHostReconnectingStaysNone
} from './pet-speech-overlay-hold-core'

export function persistOffOverlayLeftoverHeldIdleAcquiringMasterOffHidesAll(
  persistEnabled: boolean,
  keepWhenNoHost: boolean,
  overlayWhileSpeaking: boolean,
  afterKeepHoldPause: boolean,
  sessionHeld: boolean,
  isAcquiring: boolean,
  masterEnabled: boolean
): boolean {
  if (
    !persistOffOverlayJsReleaseEvaluateKeepWhenNoHostLeftoverHeldIdleAcquiringReleases(
      persistEnabled,
      keepWhenNoHost,
      overlayWhileSpeaking,
      afterKeepHoldPause,
      sessionHeld,
      isAcquiring
    )
  ) {
    return false
  }
  if (masterEnabled) {
    return false
  }
  const reason = persistWriteReleaseReason(persistEnabled, masterEnabled)
  if (reason !== 'MASTER_OFF') {
    return false
  }
  const plan = persistNotificationPlan(reason)
  const contract = persistWriteContract(reason)
  return (
    !plan.showFgs &&
    !plan.showServiceRow &&
    !plan.showResumeChip &&
    contract.aftermath === 'CANCEL_ALL' &&
    contract.cancelResumeChip &&
    !contract.reacquireHold &&
    !contract.startTts
  )
}

export function persistOnOverlayLeftoverHeldIdleAcquiringMasterOffHidesAll(
  persistEnabled: boolean,
  keepWhenNoHost: boolean,
  overlayWhileSpeaking: boolean,
  afterKeepHoldPause: boolean,
  sessionHeld: boolean,
  isAcquiring: boolean,
  masterEnabled: boolean
): boolean {
  if (!persistEnabled || masterEnabled || !overlayWhileSpeaking || !afterKeepHoldPause) {
    return false
  }
  if (!sessionHeld || !isAcquiring) {
    return false
  }
  const reason = persistWriteReleaseReason(persistEnabled, masterEnabled)
  if (reason !== 'MASTER_OFF') {
    return false
  }
  const plan = persistNotificationPlan(reason)
  return !plan.showFgs && !plan.showServiceRow && !plan.showResumeChip
}

export function persistOffOverlayLeftoverHeldIdleAcquiringPersistOffStopCancelsAll(
  persistEnabled: boolean,
  keepWhenNoHost: boolean,
  overlayWhileSpeaking: boolean,
  afterKeepHoldPause: boolean,
  sessionHeld: boolean,
  isAcquiring: boolean
): boolean {
  if (
    !persistOffOverlayJsReleaseEvaluateKeepWhenNoHostLeftoverHeldIdleAcquiringReleases(
      persistEnabled,
      keepWhenNoHost,
      overlayWhileSpeaking,
      afterKeepHoldPause,
      sessionHeld,
      isAcquiring
    )
  ) {
    return false
  }
  const reason = persistWriteReleaseReason(false, true)
  if (reason !== 'PERSIST_OFF_STOP') {
    return false
  }
  const contract = persistWriteContract(reason)
  return contract.aftermath === 'CANCEL_ALL' && contract.cancelResumeChip && !contract.reacquireHold
}

export function persistOffOverlayJsReleaseLeftoverHeldIdleAcquiringCancelsAll(
  persistEnabled: boolean,
  keepWhenNoHost: boolean,
  overlayWhileSpeaking: boolean,
  afterKeepHoldPause: boolean,
  sessionHeld: boolean,
  isAcquiring: boolean
): boolean {
  if (
    !persistOffOverlayJsReleaseEvaluateKeepWhenNoHostLeftoverHeldIdleAcquiringReleases(
      persistEnabled,
      keepWhenNoHost,
      overlayWhileSpeaking,
      afterKeepHoldPause,
      sessionHeld,
      isAcquiring
    )
  ) {
    return false
  }
  const contract = persistWriteContract('JS_RELEASE')
  return (
    contract.aftermath === 'CANCEL_ALL' &&
    contract.cancelResumeChip &&
    !contract.reacquireHold &&
    !contract.startTts
  )
}

export function persistOffOverlayJsReleaseEvaluateKeepWhenNoHostLeftoverHeldIdleAcquiringReleases(
  persistEnabled: boolean,
  keepWhenNoHost: boolean,
  overlayWhileSpeaking: boolean,
  afterKeepHoldPause: boolean,
  sessionHeld: boolean,
  isAcquiring: boolean
): boolean {
  return (
    persistOffOverlayAfterKeepHoldPauseNeverHoldsSession(
      persistEnabled,
      overlayWhileSpeaking,
      afterKeepHoldPause
    ) &&
    keepWhenNoHost &&
    sessionHeld &&
    isAcquiring
  )
}

export function persistOffOverlayJsReleaseEvaluateKeepWhenNoHostConnectedStaysNone(
  persistEnabled: boolean,
  keepWhenNoHost: boolean,
  overlayWhileSpeaking: boolean,
  afterKeepHoldPause: boolean,
  sessionHeld: boolean
): boolean {
  return persistOffOverlayJsReleaseEvaluateKeepWhenNoHostReconnectingStaysNone(
    persistEnabled,
    keepWhenNoHost,
    overlayWhileSpeaking,
    afterKeepHoldPause,
    sessionHeld
  )
}

export function persistOffOverlayLeftoverHeldIdleAcquiringReleases(
  persistEnabled: boolean,
  overlayWhileSpeaking: boolean,
  afterKeepHoldPause: boolean,
  sessionHeld: boolean,
  isAcquiring: boolean
): boolean {
  return (
    persistOffOverlayAfterKeepHoldPauseNeverHoldsSession(
      persistEnabled,
      overlayWhileSpeaking,
      afterKeepHoldPause
    ) &&
    sessionHeld &&
    isAcquiring
  )
}

export function persistOffOverlayLeftoverHeldIdleAcquiringMasterOffKeepHostOffHidesAll(
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
    !persistOffOverlayLeftoverHeldIdleAcquiringReleases(
      persistEnabled,
      overlayWhileSpeaking,
      afterKeepHoldPause,
      sessionHeld,
      isAcquiring
    )
  ) {
    return false
  }
  if (masterEnabled) {
    return false
  }
  const reason = persistWriteReleaseReason(persistEnabled, masterEnabled)
  if (reason !== 'MASTER_OFF') {
    return false
  }
  const plan = persistNotificationPlan(reason)
  const contract = persistWriteContract(reason)
  return (
    !plan.showFgs &&
    !plan.showServiceRow &&
    !plan.showResumeChip &&
    contract.aftermath === 'CANCEL_ALL' &&
    contract.cancelResumeChip &&
    !contract.reacquireHold &&
    !contract.startTts
  )
}

export function persistOffOverlayLeftoverHeldIdleAcquiringMasterOffKeepHostOffJsHoldActionIsNull(
  persistEnabled: boolean,
  keepWhenNoHost: boolean,
  overlayWhileSpeaking: boolean,
  afterKeepHoldPause: boolean,
  sessionHeld: boolean,
  isAcquiring: boolean,
  masterEnabled: boolean
): boolean {
  if (
    !persistOffOverlayLeftoverHeldIdleAcquiringMasterOffKeepHostOffHidesAll(
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
