import {
  ACTION_RELEASE_SESSION,
  parseJsReleaseReason,
  persistNotificationPlan,
  persistWriteContract,
  persistWriteReleaseReason,
  resolveReleaseReason
} from './pet-speech-persist-write-core'

export function persistOnOverlayPauseAfterKeepHoldPauseShowsResumeChip(
  afterKeepHoldPause: boolean,
  overlayWhileSpeaking: boolean,
  persistEnabled: boolean,
  masterEnabled: boolean
): boolean {
  if (
    !persistOnOverlayPauseAfterKeepHoldPausePostsResumeChip(
      afterKeepHoldPause,
      overlayWhileSpeaking,
      persistEnabled,
      masterEnabled
    )
  ) {
    return false
  }
  const plan = persistNotificationPlan('PAUSE')
  return !plan.showFgs && !plan.showServiceRow && plan.showResumeChip
}

export function persistOffOverlayPauseAfterKeepHoldPauseHidesNotifications(
  afterKeepHoldPause: boolean,
  overlayWhileSpeaking: boolean,
  persistEnabled: boolean
): boolean {
  if (
    !persistOffOverlayPauseAfterKeepHoldPauseCancelsAll(
      afterKeepHoldPause,
      overlayWhileSpeaking,
      persistEnabled
    )
  ) {
    return false
  }
  const plan = persistNotificationPlan('PERSIST_OFF_STOP')
  return !plan.showFgs && !plan.showServiceRow && !plan.showResumeChip
}

export function persistOnOverlayJsReleaseAfterKeepHoldPauseHidesNotifications(
  afterKeepHoldPause: boolean,
  overlayWhileSpeaking: boolean,
  persistEnabled: boolean,
  masterEnabled: boolean
): boolean {
  if (
    !persistOnOverlayJsReleaseAfterKeepHoldPauseCancelsAll(
      afterKeepHoldPause,
      overlayWhileSpeaking,
      persistEnabled,
      masterEnabled
    )
  ) {
    return false
  }
  const plan = persistNotificationPlan('JS_RELEASE')
  return !plan.showFgs && !plan.showServiceRow && !plan.showResumeChip
}

export function persistOnOverlayWriteOffAfterKeepHoldPauseCancelsAll(
  afterKeepHoldPause: boolean,
  overlayWhileSpeaking: boolean,
  persistEnabledAfterWrite: boolean,
  masterEnabled: boolean
): boolean {
  if (!afterKeepHoldPause || !overlayWhileSpeaking || persistEnabledAfterWrite || !masterEnabled) {
    return false
  }
  const reason = persistWriteReleaseReason(false, true)
  if (reason !== 'PERSIST_OFF_STOP') {
    return false
  }
  const contract = persistWriteContract(reason)
  return (
    contract.aftermath === 'CANCEL_ALL' &&
    contract.cancelResumeChip &&
    contract.cancelMediaStyle &&
    !contract.startTts &&
    !contract.reacquireHold &&
    !contract.mayShowServiceRow &&
    contract.serviceAction === ACTION_RELEASE_SESSION
  )
}

export function persistOnOverlayWriteOffAfterKeepHoldPauseDoesNotShowFgs(
  afterKeepHoldPause: boolean,
  overlayWhileSpeaking: boolean,
  persistEnabledAfterWrite: boolean,
  masterEnabled: boolean
): boolean {
  if (
    !persistOnOverlayWriteOffAfterKeepHoldPauseCancelsAll(
      afterKeepHoldPause,
      overlayWhileSpeaking,
      persistEnabledAfterWrite,
      masterEnabled
    )
  ) {
    return false
  }
  return persistNotificationPlan('PERSIST_OFF_STOP').showFgs === false
}
export function persistOnOverlayPauseAfterKeepHoldPausePostsResumeChip(
  afterKeepHoldPause: boolean,
  overlayWhileSpeaking: boolean,
  persistEnabled: boolean,
  masterEnabled: boolean
): boolean {
  if (!afterKeepHoldPause || !overlayWhileSpeaking || !persistEnabled || !masterEnabled) {
    return false
  }
  const reason = resolveReleaseReason('PAUSE', persistEnabled, masterEnabled)
  if (reason !== 'PAUSE') {
    return false
  }
  const contract = persistWriteContract(reason)
  return (
    contract.aftermath === 'POST_RESUME_CHIP' &&
    !contract.cancelResumeChip &&
    contract.cancelMediaStyle &&
    !contract.startTts &&
    !contract.reacquireHold &&
    !contract.mayShowServiceRow &&
    contract.serviceAction === ACTION_RELEASE_SESSION
  )
}

export function persistOffOverlayPauseAfterKeepHoldPauseCancelsAll(
  afterKeepHoldPause: boolean,
  overlayWhileSpeaking: boolean,
  persistEnabled: boolean
): boolean {
  if (!afterKeepHoldPause || !overlayWhileSpeaking || persistEnabled) {
    return false
  }
  const reason = resolveReleaseReason('PAUSE', persistEnabled, true)
  if (reason !== 'PERSIST_OFF_STOP') {
    return false
  }
  const contract = persistWriteContract(reason)
  return (
    contract.aftermath === 'CANCEL_ALL' &&
    contract.cancelResumeChip &&
    contract.cancelMediaStyle &&
    !contract.startTts &&
    !contract.reacquireHold
  )
}

export function persistOffOverlayJsReleaseAfterKeepHoldPauseCancelsAll(
  afterKeepHoldPause: boolean,
  overlayWhileSpeaking: boolean,
  persistEnabled: boolean
): boolean {
  if (!afterKeepHoldPause || !overlayWhileSpeaking || persistEnabled) {
    return false
  }
  const contract = persistWriteContract(parseJsReleaseReason('JS_RELEASE'))
  return (
    contract.aftermath === 'CANCEL_ALL' &&
    contract.cancelResumeChip &&
    contract.cancelMediaStyle &&
    !contract.startTts &&
    !contract.reacquireHold
  )
}

export function persistOnOverlayJsReleaseAfterKeepHoldPauseCancelsAll(
  afterKeepHoldPause: boolean,
  overlayWhileSpeaking: boolean,
  persistEnabled: boolean,
  masterEnabled: boolean
): boolean {
  if (!afterKeepHoldPause || !overlayWhileSpeaking || !persistEnabled || !masterEnabled) {
    return false
  }
  const reason = parseJsReleaseReason(null)
  if (reason !== 'JS_RELEASE') {
    return false
  }
  const contract = persistWriteContract(reason)
  return (
    contract.aftermath === 'CANCEL_ALL' &&
    contract.cancelResumeChip &&
    contract.cancelMediaStyle &&
    !contract.startTts &&
    !contract.reacquireHold &&
    !contract.mayShowServiceRow &&
    contract.serviceAction === ACTION_RELEASE_SESSION
  )
}

export function persistOnOverlayMasterOffAfterKeepHoldPauseCancelsAll(
  afterKeepHoldPause: boolean,
  overlayWhileSpeaking: boolean,
  masterEnabled: boolean
): boolean {
  if (!afterKeepHoldPause || !overlayWhileSpeaking || masterEnabled) {
    return false
  }
  const reason = persistWriteReleaseReason(true, false)
  if (reason !== 'MASTER_OFF') {
    return false
  }
  const contract = persistWriteContract(reason)
  return (
    contract.aftermath === 'CANCEL_ALL' &&
    contract.cancelResumeChip &&
    contract.cancelMediaStyle &&
    !contract.startTts &&
    !contract.reacquireHold &&
    !contract.mayShowServiceRow
  )
}
