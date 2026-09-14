export const ACTION_RELEASE_SESSION = 'expo.modules.petspeech.ACTION_RELEASE_SESSION'
export const JS_RELEASE_NATIVE_REASON = 'JS_RELEASE' as const

export function jsReleaseNativeExtra(raw: string | null | undefined = null): PersistWriteReason {
  return parseJsReleaseReason(raw)
}

export type PersistWriteReason = 'MASTER_OFF' | 'PERSIST_OFF_STOP' | 'JS_RELEASE' | 'PAUSE'

export type PersistWriteAftermath = 'POST_RESUME_CHIP' | 'CANCEL_ALL'

export type PersistWriteContract = {
  aftermath: PersistWriteAftermath
  cancelResumeChip: boolean
  cancelMediaStyle: boolean
  serviceAction: string
  reacquireHold: boolean
  startTts: boolean
  mayShowServiceRow: boolean
}

export type PersistNotificationPlan = {
  showFgs: boolean
  showServiceRow: boolean
  showResumeChip: boolean
}

export function persistNotificationAfterPause(): PersistNotificationPlan {
  return { showFgs: false, showServiceRow: false, showResumeChip: true }
}

export function persistNotificationAfterMasterOff(): PersistNotificationPlan {
  return { showFgs: false, showServiceRow: false, showResumeChip: false }
}

export const FGS_NOTIFICATION_ID = 4040
export const SERVICE_ROW_NOTIFICATION_ID = 4041
export const RESUME_CHIP_NOTIFICATION_ID = 4042

export function persistNotificationWhileHeld(showServiceRow: boolean): PersistNotificationPlan {
  return { showFgs: true, showServiceRow, showResumeChip: false }
}

export function hidingServiceStatusRowDoesNotDropFgs(): boolean {
  const hidden = persistNotificationWhileHeld(false)
  const shown = persistNotificationWhileHeld(true)
  return (
    hidden.showFgs &&
    shown.showFgs &&
    hidden.showServiceRow === false &&
    shown.showServiceRow &&
    hidden.showResumeChip === false &&
    shown.showResumeChip === false &&
    FGS_NOTIFICATION_ID !== SERVICE_ROW_NOTIFICATION_ID &&
    SERVICE_ROW_NOTIFICATION_ID !== RESUME_CHIP_NOTIFICATION_ID &&
    FGS_NOTIFICATION_ID !== RESUME_CHIP_NOTIFICATION_ID
  )
}

export function whileHeldFgsIsMediaStyleNotServiceRow(keepHold: boolean): boolean {
  if (!keepHold) {
    const idle = persistNotificationAfterMasterOff()
    return idle.showFgs === false && idle.showServiceRow === false
  }
  const plan = persistNotificationWhileHeld(true)
  return (
    plan.showFgs &&
    plan.showResumeChip === false &&
    FGS_NOTIFICATION_ID !== SERVICE_ROW_NOTIFICATION_ID
  )
}

export function persistOnSessionHeldFgsIsMediaStyleId4040NeverServiceRow4041(
  persistEnabled: boolean,
  masterEnabled: boolean,
  sessionHeld: boolean
): boolean {
  if (!persistEnabled || !masterEnabled || !sessionHeld) {
    return false
  }
  const withRow = persistNotificationWhileHeld(true)
  const hiddenRow = persistNotificationWhileHeld(false)
  return (
    whileHeldFgsIsMediaStyleNotServiceRow(true) &&
    withRow.showFgs &&
    hiddenRow.showFgs &&
    FGS_NOTIFICATION_ID === 4040 &&
    SERVICE_ROW_NOTIFICATION_ID === 4041 &&
    FGS_NOTIFICATION_ID !== SERVICE_ROW_NOTIFICATION_ID
  )
}

export function resumeChipNotifyIdNeverStartsForeground(): boolean {
  return (
    RESUME_CHIP_NOTIFICATION_ID === 4042 &&
    RESUME_CHIP_NOTIFICATION_ID !== FGS_NOTIFICATION_ID &&
    RESUME_CHIP_NOTIFICATION_ID !== SERVICE_ROW_NOTIFICATION_ID &&
    persistNotificationAfterPause().showFgs === false &&
    persistNotificationAfterPause().showServiceRow === false &&
    persistNotificationAfterPause().showResumeChip
  )
}

export function persistNotificationPlan(reason: PersistWriteReason): PersistNotificationPlan {
  return persistWriteContract(reason).aftermath === 'POST_RESUME_CHIP'
    ? persistNotificationAfterPause()
    : persistNotificationAfterMasterOff()
}

export function persistWriteReleaseReason(
  persistEnabled: boolean | undefined,
  masterEnabled: boolean | undefined
): PersistWriteReason | null {
  if (masterEnabled === false) {
    return 'MASTER_OFF'
  }
  if (persistEnabled === false) {
    return 'PERSIST_OFF_STOP'
  }
  return null
}

export function persistWriteContract(reason: PersistWriteReason): PersistWriteContract {
  if (reason === 'PAUSE') {
    return {
      aftermath: 'POST_RESUME_CHIP',
      cancelResumeChip: false,
      cancelMediaStyle: true,
      serviceAction: ACTION_RELEASE_SESSION,
      reacquireHold: false,
      startTts: false,
      mayShowServiceRow: false
    }
  }
  return {
    aftermath: 'CANCEL_ALL',
    cancelResumeChip: true,
    cancelMediaStyle: true,
    serviceAction: ACTION_RELEASE_SESSION,
    reacquireHold: false,
    startTts: false,
    mayShowServiceRow: false
  }
}
export function parseJsReleaseReason(raw: string | null | undefined): PersistWriteReason {
  if (!raw) {
    return 'JS_RELEASE'
  }
  if (
    raw === 'MASTER_OFF' ||
    raw === 'PERSIST_OFF_STOP' ||
    raw === 'JS_RELEASE' ||
    raw === 'PAUSE'
  ) {
    return raw
  }
  return 'JS_RELEASE'
}

export function resolveReleaseReason(
  raw: string | null | undefined,
  persistEnabled: boolean,
  masterEnabled: boolean = true
): PersistWriteReason {
  if (!masterEnabled) {
    return 'MASTER_OFF'
  }
  const parsed = parseJsReleaseReason(raw)
  if (parsed === 'PAUSE' && !persistEnabled) {
    return 'PERSIST_OFF_STOP'
  }
  return parsed
}
