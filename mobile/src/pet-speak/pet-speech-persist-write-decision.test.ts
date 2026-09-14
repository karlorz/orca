import { describe, expect, it } from 'vitest'
import {
  ACTION_BOOT_COMPLETED,
  ACTION_LOCKED_BOOT_COMPLETED,
  ACTION_RELEASE_SESSION,
  JS_RELEASE_NATIVE_REASON,
  bootCompletedKeepHostOnStillNeverStartsFgs,
  bootCompletedNotificationPlan,
  bootCompletedPostsResumeChipOnlyNeverStartsFgs,
  bootCompletedResumeChipTapDoesNotStartTts,
  bootReceiverMayStartForeground,
  isBootAction,
  jsReleaseNativeExtra,
  parseJsReleaseReason,
  persistOffOverlayJsReleaseAfterKeepHoldPauseCancelsAll,
  persistNotificationPlan,
  persistNotificationAfterPause,
  persistOffOverlayPauseAfterKeepHoldPauseCancelsAll,
  persistOffOverlayPauseAfterKeepHoldPauseHidesNotifications,
  persistOnOverlayJsReleaseAfterKeepHoldPauseCancelsAll,
  persistOnOverlayJsReleaseAfterKeepHoldPauseHidesNotifications,
  persistOnOverlayMasterOffAfterKeepHoldPauseCancelsAll,
  persistOnOverlayPauseAfterKeepHoldPausePostsResumeChip,
  persistOnOverlayPauseAfterKeepHoldPauseShowsResumeChip,
  persistOnOverlayWriteOffAfterKeepHoldPauseCancelsAll,
  persistOnOverlayWriteOffAfterKeepHoldPauseDoesNotShowFgs,
  persistNotificationWhileHeld,
  hidingServiceStatusRowDoesNotDropFgs,
  whileHeldFgsIsMediaStyleNotServiceRow,
  persistOnSessionHeldFgsIsMediaStyleId4040NeverServiceRow4041,
  resumeChipNotifyIdNeverStartsForeground,
  FGS_NOTIFICATION_ID,
  SERVICE_ROW_NOTIFICATION_ID,
  RESUME_CHIP_NOTIFICATION_ID,
  persistWriteContract,
  persistWriteReleaseReason,
  resolveReleaseReason
} from './pet-speech-persist-write-decision'
describe('persist-on overlay write-off after Pause-after-keepHold', () => {
  it('still CANCEL_ALL — cancels chip and MediaStyle, no TTS, no hold', () => {
    expect(persistOnOverlayWriteOffAfterKeepHoldPauseCancelsAll(true, true, false, true)).toBe(true)
    const reason = persistWriteReleaseReason(false, true)
    expect(reason).toBe('PERSIST_OFF_STOP')
    const contract = persistWriteContract(reason!)
    expect(contract.aftermath).toBe('CANCEL_ALL')
    expect(contract.cancelResumeChip).toBe(true)
    expect(contract.cancelMediaStyle).toBe(true)
    expect(contract.startTts).toBe(false)
    expect(contract.reacquireHold).toBe(false)
    expect(contract.mayShowServiceRow).toBe(false)
    expect(contract.serviceAction).toBe(ACTION_RELEASE_SESSION)
    expect(persistOnOverlayWriteOffAfterKeepHoldPauseDoesNotShowFgs(true, true, false, true)).toBe(
      true
    )
    expect(persistOnOverlayWriteOffAfterKeepHoldPauseDoesNotShowFgs(true, true, true, true)).toBe(
      false
    )
    expect(persistNotificationPlan('PERSIST_OFF_STOP').showFgs).toBe(false)
  })

  it('does not treat persist-on overlay as a write-off', () => {
    expect(persistOnOverlayWriteOffAfterKeepHoldPauseCancelsAll(true, true, true, true)).toBe(false)
    expect(persistWriteReleaseReason(true, true)).toBeNull()
  })

  it('master-off with persist-on overlay after Pause-after-keepHold still CANCEL_ALL', () => {
    expect(persistOnOverlayMasterOffAfterKeepHoldPauseCancelsAll(true, true, false)).toBe(true)
    const reason = persistWriteReleaseReason(true, false)
    expect(reason).toBe('MASTER_OFF')
    const contract = persistWriteContract(reason!)
    expect(contract.aftermath).toBe('CANCEL_ALL')
    expect(contract.cancelResumeChip).toBe(true)
    expect(contract.cancelMediaStyle).toBe(true)
    expect(contract.startTts).toBe(false)
    expect(contract.reacquireHold).toBe(false)
  })
})

describe('persist-on overlay JS release after Pause-after-keepHold', () => {
  it('still CANCEL_ALL', () => {
    expect(parseJsReleaseReason(null)).toBe('JS_RELEASE')
    expect(parseJsReleaseReason('not-a-reason')).toBe('JS_RELEASE')
    expect(jsReleaseNativeExtra(null)).toBe(JS_RELEASE_NATIVE_REASON)
    expect(jsReleaseNativeExtra()).toBe('JS_RELEASE')
    expect(persistOnOverlayJsReleaseAfterKeepHoldPauseCancelsAll(true, true, true, true)).toBe(true)
    const contract = persistWriteContract(parseJsReleaseReason(null))
    expect(contract.aftermath).toBe('CANCEL_ALL')
    expect(contract.cancelResumeChip).toBe(true)
    expect(contract.cancelMediaStyle).toBe(true)
    expect(contract.startTts).toBe(false)
    expect(contract.reacquireHold).toBe(false)
    expect(contract.mayShowServiceRow).toBe(false)
    expect(contract.serviceAction).toBe(ACTION_RELEASE_SESSION)
  })

  it('persist-off overlay JS release after Pause-after-keepHold still CANCEL_ALL', () => {
    expect(persistOffOverlayJsReleaseAfterKeepHoldPauseCancelsAll(true, true, false)).toBe(true)
    expect(persistOnOverlayJsReleaseAfterKeepHoldPauseCancelsAll(true, true, false, true)).toBe(
      false
    )
    const contract = persistWriteContract('JS_RELEASE')
    expect(contract.aftermath).toBe('CANCEL_ALL')
    expect(contract.cancelResumeChip).toBe(true)
    expect(contract.startTts).toBe(false)
    expect(contract.reacquireHold).toBe(false)
  })
})

describe('persist-on overlay Pause after Pause-after-keepHold', () => {
  it('still POST_RESUME_CHIP — keeps chip, no TTS, no hold', () => {
    expect(parseJsReleaseReason('PAUSE')).toBe('PAUSE')
    expect(resolveReleaseReason('PAUSE', true, true)).toBe('PAUSE')
    expect(persistOnOverlayPauseAfterKeepHoldPausePostsResumeChip(true, true, true, true)).toBe(
      true
    )
    expect(persistOnOverlayJsReleaseAfterKeepHoldPauseCancelsAll(true, true, true, true)).toBe(true)
    const contract = persistWriteContract('PAUSE')
    expect(contract.aftermath).toBe('POST_RESUME_CHIP')
    expect(contract.cancelResumeChip).toBe(false)
    expect(contract.cancelMediaStyle).toBe(true)
    expect(contract.startTts).toBe(false)
    expect(contract.reacquireHold).toBe(false)
    expect(contract.mayShowServiceRow).toBe(false)
    expect(contract.serviceAction).toBe(ACTION_RELEASE_SESSION)
    const jsRelease = persistWriteContract('JS_RELEASE')
    expect(jsRelease.aftermath).toBe('CANCEL_ALL')
    expect(jsRelease.cancelResumeChip).toBe(true)
    expect(persistOnOverlayPauseAfterKeepHoldPauseShowsResumeChip(true, true, true, true)).toBe(
      true
    )
    expect(persistNotificationPlan('PAUSE')).toEqual({
      showFgs: false,
      showServiceRow: false,
      showResumeChip: true
    })
    expect(
      persistOnOverlayJsReleaseAfterKeepHoldPauseHidesNotifications(true, true, true, true)
    ).toBe(true)
    expect(persistNotificationPlan('JS_RELEASE')).toEqual({
      showFgs: false,
      showServiceRow: false,
      showResumeChip: false
    })
  })

  it('persist-off overlay Pause after Pause-after-keepHold still CANCEL_ALL', () => {
    expect(resolveReleaseReason('PAUSE', false, true)).toBe('PERSIST_OFF_STOP')
    expect(persistOffOverlayPauseAfterKeepHoldPauseCancelsAll(true, true, false)).toBe(true)
    expect(persistOnOverlayPauseAfterKeepHoldPausePostsResumeChip(true, true, false, true)).toBe(
      false
    )
    const contract = persistWriteContract('PERSIST_OFF_STOP')
    expect(contract.aftermath).toBe('CANCEL_ALL')
    expect(contract.cancelResumeChip).toBe(true)
    expect(contract.startTts).toBe(false)
    expect(contract.reacquireHold).toBe(false)
    expect(persistOffOverlayPauseAfterKeepHoldPauseHidesNotifications(true, true, false)).toBe(true)
    expect(persistNotificationPlan('PERSIST_OFF_STOP')).toEqual({
      showFgs: false,
      showServiceRow: false,
      showResumeChip: false
    })
  })
})

describe('BOOT_COMPLETED persist-on posts resume chip only and never starts FGS', () => {
  it('posts resume chip only when persist and master are on; never starts FGS', () => {
    expect(isBootAction(ACTION_BOOT_COMPLETED)).toBe(true)
    expect(isBootAction(ACTION_LOCKED_BOOT_COMPLETED)).toBe(true)
    expect(isBootAction(null)).toBe(false)
    expect(isBootAction('android.intent.action.MY_PACKAGE_REPLACED')).toBe(false)
    expect(bootReceiverMayStartForeground()).toBe(false)
    expect(bootCompletedPostsResumeChipOnlyNeverStartsFgs(true, true)).toBe(true)
    expect(bootCompletedNotificationPlan(true, true)).toEqual({
      showFgs: false,
      showServiceRow: false,
      showResumeChip: true
    })
    expect(bootCompletedPostsResumeChipOnlyNeverStartsFgs(false, true)).toBe(true)
    expect(bootCompletedPostsResumeChipOnlyNeverStartsFgs(true, false)).toBe(true)
    expect(bootCompletedPostsResumeChipOnlyNeverStartsFgs(false, false)).toBe(true)
    expect(bootCompletedNotificationPlan(false, true).showResumeChip).toBe(false)
    expect(bootCompletedNotificationPlan(true, false).showFgs).toBe(false)
  })

  it('resume-chip tap does not start TTS and does not reacquire hold', () => {
    expect(bootCompletedResumeChipTapDoesNotStartTts(true, true)).toBe(true)
    expect(bootCompletedResumeChipTapDoesNotStartTts(false, true)).toBe(true)
    expect(bootCompletedResumeChipTapDoesNotStartTts(true, false)).toBe(true)
    expect(persistWriteContract('PAUSE').startTts).toBe(false)
    expect(persistWriteContract('MASTER_OFF').reacquireHold).toBe(false)
  })

  it('keepWhenNoHost on still posts chip only and never starts FGS from the boot receiver', () => {
    expect(bootCompletedKeepHostOnStillNeverStartsFgs(true, true, true)).toBe(true)
    expect(bootCompletedKeepHostOnStillNeverStartsFgs(true, true, false)).toBe(false)
    expect(bootCompletedKeepHostOnStillNeverStartsFgs(false, true, true)).toBe(false)
    expect(bootReceiverMayStartForeground()).toBe(false)
  })
})

describe('while-held Headuck status row is not the FGS', () => {
  it('hiding the service status row does not drop MediaStyle FGS', () => {
    expect(hidingServiceStatusRowDoesNotDropFgs()).toBe(true)
    expect(persistNotificationWhileHeld(false)).toEqual({
      showFgs: true,
      showServiceRow: false,
      showResumeChip: false
    })
    expect(persistNotificationWhileHeld(true).showFgs).toBe(true)
    expect(FGS_NOTIFICATION_ID).not.toBe(SERVICE_ROW_NOTIFICATION_ID)
    expect(SERVICE_ROW_NOTIFICATION_ID).not.toBe(RESUME_CHIP_NOTIFICATION_ID)
  })

  it('while-held FGS is MediaStyle, not the Headuck service row', () => {
    expect(whileHeldFgsIsMediaStyleNotServiceRow(true)).toBe(true)
    expect(whileHeldFgsIsMediaStyleNotServiceRow(false)).toBe(true)
    expect(persistNotificationWhileHeld(true).showFgs).toBe(true)
  })

  it('persist-on session-held FGS is MediaStyle id 4040, never Headuck row 4041', () => {
    expect(persistOnSessionHeldFgsIsMediaStyleId4040NeverServiceRow4041(true, true, true)).toBe(
      true
    )
    expect(persistOnSessionHeldFgsIsMediaStyleId4040NeverServiceRow4041(false, true, true)).toBe(
      false
    )
    expect(persistOnSessionHeldFgsIsMediaStyleId4040NeverServiceRow4041(true, true, false)).toBe(
      false
    )
    expect(FGS_NOTIFICATION_ID).toBe(4040)
    expect(SERVICE_ROW_NOTIFICATION_ID).toBe(4041)
  })

  it('resume-chip notify id 4042 is never startForeground', () => {
    expect(resumeChipNotifyIdNeverStartsForeground()).toBe(true)
    expect(RESUME_CHIP_NOTIFICATION_ID).toBe(4042)
    expect(RESUME_CHIP_NOTIFICATION_ID).not.toBe(FGS_NOTIFICATION_ID)
    expect(RESUME_CHIP_NOTIFICATION_ID).not.toBe(SERVICE_ROW_NOTIFICATION_ID)
    expect(persistNotificationAfterPause().showFgs).toBe(false)
  })
})
