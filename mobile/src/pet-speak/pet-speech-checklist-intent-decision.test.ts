import { describe, expect, it } from 'vitest'
import {
  ACTION_APP_NOTIFICATION_SETTINGS,
  ACTION_APPLICATION_DETAILS_SETTINGS,
  ACTION_CHANNEL_NOTIFICATION_SETTINGS,
  ACTION_IGNORE_BATTERY_SETTINGS,
  ACTION_MANAGE_OVERLAY,
  ACTION_REQUEST_IGNORE_BATTERY,
  EXTRA_APP_PACKAGE,
  EXTRA_CHANNEL_ID,
  MOTOROLA_DEVICE_GUARD_PACKAGE,
  MOTOROLA_PORTAL_ACTIVITY,
  PLAYBACK_CHANNEL_ID,
  checklistIntentTargets,
  lockChannelVsOverlayTargetsAreExclusive
} from './pet-speech-checklist-intent-decision'

const PKG = 'com.stably.orca.mobile'

describe('PetSpeechChecklistIntentDecision lock-channel vs overlay exclusivity', () => {
  it('lock-channel opens channel settings and overlay opens manage overlay, never each other', () => {
    expect(lockChannelVsOverlayTargetsAreExclusive(PKG, PLAYBACK_CHANNEL_ID)).toBe(true)

    const lock = checklistIntentTargets('lock-channel', PKG, PLAYBACK_CHANNEL_ID)
    expect(lock[0]?.action).toBe(ACTION_CHANNEL_NOTIFICATION_SETTINGS)
    expect(lock[0]?.extras[EXTRA_APP_PACKAGE]).toBe(PKG)
    expect(lock[0]?.extras[EXTRA_CHANNEL_ID]).toBe(PLAYBACK_CHANNEL_ID)
    expect(lock[1]?.action).toBe(ACTION_APP_NOTIFICATION_SETTINGS)
    expect(lock.some((target) => target.action === ACTION_MANAGE_OVERLAY)).toBe(false)

    const overlay = checklistIntentTargets('overlay', PKG, PLAYBACK_CHANNEL_ID)
    expect(overlay).toEqual([
      {
        action: ACTION_MANAGE_OVERLAY,
        usePackageUri: true,
        extras: {}
      }
    ])
    expect(overlay.some((target) => target.action === ACTION_CHANNEL_NOTIFICATION_SETTINGS)).toBe(
      false
    )
    expect(overlay.some((target) => EXTRA_CHANNEL_ID in target.extras)).toBe(false)
  })

  it('allowlisted items stay notifications/battery/lock-channel/overlay/device-guard only', () => {
    const notifications = checklistIntentTargets('notifications', PKG, PLAYBACK_CHANNEL_ID)
    expect(notifications[0]?.action).toBe(ACTION_APP_NOTIFICATION_SETTINGS)
    expect(notifications[1]?.action).toBe(ACTION_APPLICATION_DETAILS_SETTINGS)
    expect(notifications.some((target) => target.action === ACTION_MANAGE_OVERLAY)).toBe(false)

    const battery = checklistIntentTargets('battery', PKG, PLAYBACK_CHANNEL_ID)
    expect(battery[0]?.action).toBe(ACTION_REQUEST_IGNORE_BATTERY)
    expect(battery[0]?.usePackageUri).toBe(true)
    expect(battery[1]?.action).toBe(ACTION_IGNORE_BATTERY_SETTINGS)
    expect(battery.some((target) => target.action === ACTION_CHANNEL_NOTIFICATION_SETTINGS)).toBe(
      false
    )

    const guard = checklistIntentTargets('device-guard', PKG, PLAYBACK_CHANNEL_ID)
    expect(guard).toEqual([
      {
        action: '',
        usePackageUri: false,
        extras: {},
        componentPackage: MOTOROLA_DEVICE_GUARD_PACKAGE,
        componentClass: MOTOROLA_PORTAL_ACTIVITY
      }
    ])
    expect(guard[0]?.action).not.toBe(ACTION_MANAGE_OVERLAY)
    expect(guard[0]?.action).not.toBe(ACTION_CHANNEL_NOTIFICATION_SETTINGS)

    expect(checklistIntentTargets('unknown', PKG, PLAYBACK_CHANNEL_ID)).toEqual([])
  })
})
