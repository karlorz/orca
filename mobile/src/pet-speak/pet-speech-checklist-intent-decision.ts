export const ACTION_APP_NOTIFICATION_SETTINGS = 'android.settings.APP_NOTIFICATION_SETTINGS'
export const ACTION_APPLICATION_DETAILS_SETTINGS = 'android.settings.APPLICATION_DETAILS_SETTINGS'
export const ACTION_REQUEST_IGNORE_BATTERY = 'android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS'
export const ACTION_IGNORE_BATTERY_SETTINGS =
  'android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS'
export const ACTION_CHANNEL_NOTIFICATION_SETTINGS = 'android.settings.CHANNEL_NOTIFICATION_SETTINGS'
export const ACTION_MANAGE_OVERLAY = 'android.settings.action.MANAGE_OVERLAY_PERMISSION'
export const EXTRA_APP_PACKAGE = 'android.provider.extra.APP_PACKAGE'
export const EXTRA_CHANNEL_ID = 'android.provider.extra.CHANNEL_ID'
export const PLAYBACK_CHANNEL_ID = 'orca_pet_speech_media'
export const MOTOROLA_DEVICE_GUARD_PACKAGE = 'com.motorola.deviceguard'
export const MOTOROLA_PORTAL_ACTIVITY = 'com.motorola.deviceguard.portal.activity.PortalActivity'

export type ChecklistIntentItem =
  | 'notifications'
  | 'battery'
  | 'device-guard'
  | 'lock-channel'
  | 'overlay'

export type ChecklistIntentTarget = {
  action: string
  usePackageUri: boolean
  extras: Record<string, string>
  componentPackage?: string
  componentClass?: string
}

export function checklistIntentTargets(
  item: string,
  packageName: string,
  playbackChannelId: string
): ChecklistIntentTarget[] {
  switch (item) {
    case 'notifications':
      return [
        {
          action: ACTION_APP_NOTIFICATION_SETTINGS,
          usePackageUri: false,
          extras: {
            [EXTRA_APP_PACKAGE]: packageName,
            app_package: packageName
          }
        },
        {
          action: ACTION_APPLICATION_DETAILS_SETTINGS,
          usePackageUri: true,
          extras: {}
        }
      ]
    case 'battery':
      return [
        {
          action: ACTION_REQUEST_IGNORE_BATTERY,
          usePackageUri: true,
          extras: {}
        },
        {
          action: ACTION_IGNORE_BATTERY_SETTINGS,
          usePackageUri: false,
          extras: {}
        },
        {
          action: ACTION_APPLICATION_DETAILS_SETTINGS,
          usePackageUri: true,
          extras: {}
        }
      ]
    case 'lock-channel':
      return [
        {
          action: ACTION_CHANNEL_NOTIFICATION_SETTINGS,
          usePackageUri: false,
          extras: {
            [EXTRA_APP_PACKAGE]: packageName,
            [EXTRA_CHANNEL_ID]: playbackChannelId
          }
        },
        {
          action: ACTION_APP_NOTIFICATION_SETTINGS,
          usePackageUri: false,
          extras: { [EXTRA_APP_PACKAGE]: packageName }
        }
      ]
    case 'overlay':
      return [
        {
          action: ACTION_MANAGE_OVERLAY,
          usePackageUri: true,
          extras: {}
        }
      ]
    case 'device-guard':
      return [
        {
          action: '',
          usePackageUri: false,
          extras: {},
          componentPackage: MOTOROLA_DEVICE_GUARD_PACKAGE,
          componentClass: MOTOROLA_PORTAL_ACTIVITY
        }
      ]
    default:
      return []
  }
}

export function lockChannelVsOverlayTargetsAreExclusive(
  packageName: string,
  playbackChannelId: string
): boolean {
  const lock = checklistIntentTargets('lock-channel', packageName, playbackChannelId)
  const overlay = checklistIntentTargets('overlay', packageName, playbackChannelId)
  if (lock.length === 0 || overlay.length === 0) {
    return false
  }
  const lockActions = new Set(lock.map((target) => target.action))
  const overlayActions = new Set(overlay.map((target) => target.action))
  for (const action of lockActions) {
    if (overlayActions.has(action)) {
      return false
    }
  }
  const lockHasChannel = lock.some(
    (target) =>
      target.action === ACTION_CHANNEL_NOTIFICATION_SETTINGS &&
      target.extras[EXTRA_CHANNEL_ID] === playbackChannelId
  )
  const overlayOpensManage = overlay.every(
    (target) =>
      target.action === ACTION_MANAGE_OVERLAY &&
      target.usePackageUri &&
      target.extras[EXTRA_CHANNEL_ID] == null
  )
  return (
    lockHasChannel &&
    overlayOpensManage &&
    !lockActions.has(ACTION_MANAGE_OVERLAY) &&
    !overlayActions.has(ACTION_CHANNEL_NOTIFICATION_SETTINGS)
  )
}
