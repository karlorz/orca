import { beforeEach, describe, expect, it, vi } from 'vitest'

const platform = vi.hoisted(() => ({ OS: 'android' as string, Version: 32 as number }))
const notifications = vi.hoisted(() => ({
  getPermissionsAsync: vi.fn(),
  requestPermissionsAsync: vi.fn()
}))

vi.mock('react-native', () => ({
  Platform: platform
}))
vi.mock('expo-notifications', () => notifications)

import {
  ensureNotificationPermissions,
  getNotificationPermissionState
} from './notification-permissions'

describe('notification OS permission consent', () => {
  beforeEach(() => {
    platform.OS = 'android'
    platform.Version = 32
    notifications.getPermissionsAsync.mockReset()
    notifications.requestPermissionsAsync.mockReset()
  })

  it('fail-closed Android below 33 granted does not reflect user choice', async () => {
    notifications.getPermissionsAsync.mockResolvedValue({
      status: 'granted',
      canAskAgain: true
    })
    const state = await getNotificationPermissionState()
    expect(state.granted).toBe(true)
    expect(state.authorizationReflectsUserChoice).toBe(false)
  })

  it('Android 33+ granted reflects user choice', async () => {
    platform.Version = 33
    notifications.getPermissionsAsync.mockResolvedValue({
      status: 'granted',
      canAskAgain: true
    })
    const state = await getNotificationPermissionState()
    expect(state.authorizationReflectsUserChoice).toBe(true)
  })

  it('iOS granted reflects user choice', async () => {
    platform.OS = 'ios'
    platform.Version = 18
    notifications.getPermissionsAsync.mockResolvedValue({
      status: 'granted',
      canAskAgain: true
    })
    const state = await getNotificationPermissionState()
    expect(state.authorizationReflectsUserChoice).toBe(true)
  })

  it('denied never reflects user choice even on Android 33+', async () => {
    platform.Version = 34
    notifications.getPermissionsAsync.mockResolvedValue({
      status: 'denied',
      canAskAgain: false
    })
    const state = await getNotificationPermissionState()
    expect(state.granted).toBe(false)
    expect(state.authorizationReflectsUserChoice).toBe(false)
  })

  it('ensureNotificationPermissions does not re-prompt when already granted', async () => {
    notifications.getPermissionsAsync.mockResolvedValue({
      status: 'granted',
      canAskAgain: true
    })
    await expect(ensureNotificationPermissions()).resolves.toBe(true)
    expect(notifications.requestPermissionsAsync).not.toHaveBeenCalled()
  })

  it('ensureNotificationPermissions requests when not granted', async () => {
    notifications.getPermissionsAsync.mockResolvedValue({
      status: 'undetermined',
      canAskAgain: true
    })
    notifications.requestPermissionsAsync.mockResolvedValue({ status: 'granted' })
    await expect(ensureNotificationPermissions()).resolves.toBe(true)
    expect(notifications.requestPermissionsAsync).toHaveBeenCalledOnce()
  })
})
