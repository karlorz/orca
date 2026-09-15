import {
  persistNotificationAfterMasterOff,
  persistNotificationAfterPause,
  persistWriteContract,
  type PersistNotificationPlan,
  type PersistWriteReason
} from './pet-speech-persist-write-core'

export const ACTION_BOOT_COMPLETED = 'android.intent.action.BOOT_COMPLETED'
export const ACTION_LOCKED_BOOT_COMPLETED = 'android.intent.action.LOCKED_BOOT_COMPLETED'

export function isBootAction(action: string | null | undefined): boolean {
  return action === ACTION_BOOT_COMPLETED || action === ACTION_LOCKED_BOOT_COMPLETED
}

export function bootReceiverMayStartForeground(): boolean {
  return false
}

export function bootCompletedNotificationPlan(
  persistEnabled: boolean,
  masterEnabled: boolean
): PersistNotificationPlan {
  return persistEnabled && masterEnabled
    ? persistNotificationAfterPause()
    : persistNotificationAfterMasterOff()
}

export function bootCompletedPostsResumeChipOnlyNeverStartsFgs(
  persistEnabled: boolean,
  masterEnabled: boolean
): boolean {
  if (bootReceiverMayStartForeground()) {
    return false
  }
  const plan = bootCompletedNotificationPlan(persistEnabled, masterEnabled)
  if (plan.showFgs || plan.showServiceRow) {
    return false
  }
  return plan.showResumeChip === (persistEnabled && masterEnabled)
}

export function bootCompletedResumeChipTapDoesNotStartTts(
  persistEnabled: boolean,
  masterEnabled: boolean
): boolean {
  if (!bootCompletedPostsResumeChipOnlyNeverStartsFgs(persistEnabled, masterEnabled)) {
    return false
  }
  const reason: PersistWriteReason = persistEnabled && masterEnabled ? 'PAUSE' : 'MASTER_OFF'
  const contract = persistWriteContract(reason)
  return !contract.startTts && !contract.reacquireHold
}

export function bootCompletedKeepHostOnStillNeverStartsFgs(
  persistEnabled: boolean,
  masterEnabled: boolean,
  keepWhenNoHost: boolean
): boolean {
  return (
    persistEnabled &&
    masterEnabled &&
    keepWhenNoHost &&
    !bootReceiverMayStartForeground() &&
    bootCompletedPostsResumeChipOnlyNeverStartsFgs(persistEnabled, masterEnabled)
  )
}
