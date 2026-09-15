export const ACTION_SCREEN_OFF = 'android.intent.action.SCREEN_OFF'
export const ACTION_USER_PRESENT = 'android.intent.action.USER_PRESENT'
export const ACTION_CLOSE_SYSTEM_DIALOGS = 'android.intent.action.CLOSE_SYSTEM_DIALOGS'

export const FGS_MEDIA_STYLE_NOTIFICATION_ID = 4040
export const SERVICE_ROW_NOTIFICATION_ID = 4041

export type VisibilityRetainEvent = 'home' | 'screen-off' | 'lock'

export function overlayNeverStartsForegroundFromRetain(): boolean {
  return false
}

export function visibilityRetainEventFromAction(
  action: string | null | undefined
): VisibilityRetainEvent | null {
  if (action === ACTION_CLOSE_SYSTEM_DIALOGS) {
    return 'home'
  }
  if (action === ACTION_SCREEN_OFF) {
    return 'screen-off'
  }
  if (action === ACTION_USER_PRESENT) {
    return 'lock'
  }
  return null
}

export function isVisibilityRetainAction(action: string | null | undefined): boolean {
  return visibilityRetainEventFromAction(action) != null
}

/** Home / screen-off / lock retain MediaStyle FGS 4040 while session is held. Overlay never starts FGS. */
export function persistOnSessionHeldVisibilityRetainKeepsMediaStyleFgs(
  persistEnabled: boolean,
  masterEnabled: boolean,
  sessionHeld: boolean,
  action: string
): boolean {
  if (visibilityRetainEventFromAction(action) == null) {
    return false
  }
  if (!persistEnabled || !masterEnabled || !sessionHeld) {
    return false
  }
  return (
    overlayNeverStartsForegroundFromRetain() === false &&
    FGS_MEDIA_STYLE_NOTIFICATION_ID === 4040 &&
    SERVICE_ROW_NOTIFICATION_ID === 4041 &&
    Number(FGS_MEDIA_STYLE_NOTIFICATION_ID) !== Number(SERVICE_ROW_NOTIFICATION_ID)
  )
}
