import { describe, expect, it } from 'vitest'
import {
  ACTION_CLOSE_SYSTEM_DIALOGS,
  ACTION_SCREEN_OFF,
  ACTION_USER_PRESENT,
  FGS_MEDIA_STYLE_NOTIFICATION_ID,
  SERVICE_ROW_NOTIFICATION_ID,
  isVisibilityRetainAction,
  overlayNeverStartsForegroundFromRetain,
  persistOnSessionHeldVisibilityRetainKeepsMediaStyleFgs,
  visibilityRetainEventFromAction
} from './pet-speech-fgs-retain-decision'

describe('persist-on session-held visibility retain keeps MediaStyle FGS', () => {
  it('Home, screen-off, and lock retain FGS id 4040 and never start FGS from the receiver', () => {
    expect(visibilityRetainEventFromAction(ACTION_CLOSE_SYSTEM_DIALOGS)).toBe('home')
    expect(visibilityRetainEventFromAction(ACTION_SCREEN_OFF)).toBe('screen-off')
    expect(visibilityRetainEventFromAction(ACTION_USER_PRESENT)).toBe('lock')
    expect(isVisibilityRetainAction('android.intent.action.BOOT_COMPLETED')).toBe(false)
    for (const action of [ACTION_CLOSE_SYSTEM_DIALOGS, ACTION_SCREEN_OFF, ACTION_USER_PRESENT]) {
      expect(persistOnSessionHeldVisibilityRetainKeepsMediaStyleFgs(true, true, true, action)).toBe(
        true
      )
    }
    expect(
      persistOnSessionHeldVisibilityRetainKeepsMediaStyleFgs(
        true,
        true,
        true,
        'android.intent.action.BOOT_COMPLETED'
      )
    ).toBe(false)
    expect(
      persistOnSessionHeldVisibilityRetainKeepsMediaStyleFgs(false, true, true, ACTION_SCREEN_OFF)
    ).toBe(false)
    expect(
      persistOnSessionHeldVisibilityRetainKeepsMediaStyleFgs(true, true, false, ACTION_USER_PRESENT)
    ).toBe(false)
    expect(overlayNeverStartsForegroundFromRetain()).toBe(false)
    expect(FGS_MEDIA_STYLE_NOTIFICATION_ID).toBe(4040)
    expect(SERVICE_ROW_NOTIFICATION_ID).toBe(4041)
  })
})
