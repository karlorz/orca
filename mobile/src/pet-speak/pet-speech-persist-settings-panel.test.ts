import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PetSpeechPreferences } from './pet-speech-preferences'

const {
  mockAppStateAddEventListener,
  appStateCallbacks,
  getPersistChecklistAsync,
  openPersistChecklistItemAsync,
  updatePersistSettingsAsync
} = vi.hoisted(() => {
  const callbacks: Array<(state: string) => void> = []
  return {
    appStateCallbacks: callbacks,
    mockAppStateAddEventListener: vi.fn((_event: string, cb: (state: string) => void) => {
      callbacks.push(cb)
      return {
        remove: vi.fn(() => {
          const idx = callbacks.indexOf(cb)
          if (idx !== -1) {
            callbacks.splice(idx, 1)
          }
        })
      }
    }),
    getPersistChecklistAsync: vi.fn(async () => ({
      notificationsGranted: true,
      ignoringBattery: false,
      canOpenDeviceGuard: true,
      canDrawOverlays: false
    })),
    openPersistChecklistItemAsync: vi.fn(async () => ({ opened: true })),
    updatePersistSettingsAsync: vi.fn(async () => {})
  }
})

const platform = vi.hoisted(() => ({ OS: 'android' as 'android' | 'ios', Version: 34 }))

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Switch: 'Switch',
  Text: 'Text',
  View: 'View',
  Platform: platform,
  Linking: { openSettings: vi.fn(async () => {}) },
  AppState: {
    addEventListener: mockAppStateAddEventListener
  }
}))

vi.mock('../notifications/notification-permissions', () => ({
  ensureNotificationPermissions: vi.fn(async () => true)
}))

vi.mock('@orca/expo-pet-speech', () => ({
  getExpoPetSpeechModule: () => ({
    updatePersistSettingsAsync,
    getPersistChecklistAsync,
    openPersistChecklistItemAsync
  })
}))

vi.mock('./pet-speech-preferences', () => ({
  setPetSpeechPersistEnabled: vi.fn(async () => {}),
  setPetSpeechKeepWhenNoHost: vi.fn(async () => {}),
  setPetSpeechKeepHostConnection: vi.fn(async () => {}),
  setPetSpeechShowServiceStatusRow: vi.fn(async () => {}),
  setPetSpeechOverlayWhileSpeaking: vi.fn(async () => {})
}))

import { persistDependentSwitchEnabled } from './pet-speech-persist-checklist'
import {
  setPetSpeechKeepHostConnection,
  setPetSpeechKeepWhenNoHost,
  setPetSpeechOverlayWhileSpeaking,
  setPetSpeechPersistEnabled,
  setPetSpeechShowServiceStatusRow
} from './pet-speech-preferences'
import { PetSpeechPersistSettingsPanel } from './pet-speech-persist-settings-panel'

const basePrefs: PetSpeechPreferences = {
  enabled: true,
  captionsEnabled: false,
  captionOffset: { x: 0, y: 0 },
  migrationCompleted: true,
  installUuid: 'u',
  rate: 1,
  voiceByLanguage: {},
  persistEnabled: false,
  keepWhenNoHost: true,
  keepHostConnection: true,
  showServiceStatusRow: true,
  overlayWhileSpeaking: false
}

function switchForLabel(
  root: {
    findAllByType: (type: string) => Array<{
      props: {
        children: unknown
        disabled?: boolean
        value?: boolean
        onValueChange?: (v: boolean) => void
      }
      parent?: {
        parent?: {
          findAllByType: (type: string) => Array<{
            props: { disabled?: boolean; value?: boolean; onValueChange?: (v: boolean) => void }
          }>
        }
      }
    }>
  },
  labelText: string
) {
  const label = root.findAllByType('Text').find((node) => {
    const children = node.props.children
    const text = Array.isArray(children) ? children.join('') : children
    return text === labelText
  })
  return label?.parent?.parent?.findAllByType('Switch')[0]
}

async function renderPanel(prefs: PetSpeechPreferences) {
  const onPrefsPatch = vi.fn()
  let renderer: ReturnType<typeof create>
  await act(async () => {
    renderer = create(createElement(PetSpeechPersistSettingsPanel, { prefs, onPrefsPatch }))
  })
  await act(async () => {
    await Promise.resolve()
  })
  return { renderer: renderer!, onPrefsPatch }
}

describe('PetSpeechPersistSettingsPanel', () => {
  beforeEach(() => {
    platform.OS = 'android'
    appStateCallbacks.length = 0
    getPersistChecklistAsync.mockClear()
    openPersistChecklistItemAsync.mockClear()
    vi.mocked(setPetSpeechOverlayWhileSpeaking).mockClear()
    vi.mocked(setPetSpeechPersistEnabled).mockClear()
    vi.mocked(setPetSpeechKeepHostConnection).mockClear()
    vi.mocked(setPetSpeechKeepWhenNoHost).mockClear()
    vi.mocked(setPetSpeechShowServiceStatusRow).mockClear()
    updatePersistSettingsAsync.mockClear()
  })

  it('disables Keep host and Keep when no host when persist is off', async () => {
    expect(persistDependentSwitchEnabled(false)).toBe(false)
    const { renderer } = await renderPanel(basePrefs)
    const labels = renderer.root.findAllByType('Text').map((node) => {
      const children = node.props.children
      return Array.isArray(children) ? children.join('') : children
    })
    expect(labels).toContain('PERSIST')
    expect(labels).toContain('Keep after reboot')
    expect(labels).toContain('Keep host connection')
    expect(labels).toContain('Keep when no host')

    const persist = switchForLabel(renderer.root, 'Keep after reboot')
    const keepHost = switchForLabel(renderer.root, 'Keep host connection')
    const keepIdle = switchForLabel(renderer.root, 'Keep when no host')
    const serviceRow = switchForLabel(renderer.root, 'Show service status row')
    const overlay = switchForLabel(renderer.root, 'Overlay while speaking')

    expect(persist?.props.disabled).toBeFalsy()
    expect(keepHost?.props.disabled).toBe(true)
    expect(keepIdle?.props.disabled).toBe(true)
    expect(keepHost?.props.value).toBe(false)
    expect(keepIdle?.props.value).toBe(false)
    expect(serviceRow?.props.disabled).toBeFalsy()
    expect(overlay?.props.disabled).toBeFalsy()
  })

  it('enables Keep host and Keep when no host when persist is on', async () => {
    expect(persistDependentSwitchEnabled(true)).toBe(true)
    const { renderer } = await renderPanel({
      ...basePrefs,
      persistEnabled: true
    })
    expect(switchForLabel(renderer.root, 'Keep host connection')?.props.disabled).toBeFalsy()
    expect(switchForLabel(renderer.root, 'Keep when no host')?.props.disabled).toBeFalsy()
    expect(switchForLabel(renderer.root, 'Keep host connection')?.props.value).toBe(true)
    expect(switchForLabel(renderer.root, 'Keep when no host')?.props.value).toBe(true)
  })

  it('shows the Android persist checklist and Device Guard when native reports it', async () => {
    const { renderer } = await renderPanel(basePrefs)
    const labels = renderer.root.findAllByType('Text').map((node) => {
      const children = node.props.children
      return Array.isArray(children) ? children.join('') : children
    })
    expect(labels).toContain('PERSIST CHECKLIST')
    expect(labels).toContain('Notifications: granted')
    expect(labels).toContain('Ignore battery: open settings')
    expect(labels).toContain('Show Pet voice on lock screen')
    expect(labels).toContain('Open Motorola Device Guard')
  })

  it('hides the Device Guard row when native cannot open it', async () => {
    getPersistChecklistAsync.mockResolvedValueOnce({
      notificationsGranted: true,
      ignoringBattery: true,
      canOpenDeviceGuard: false,
      canDrawOverlays: false
    })
    const { renderer } = await renderPanel(basePrefs)
    const labels = renderer.root.findAllByType('Text').map((node) => {
      const children = node.props.children
      return Array.isArray(children) ? children.join('') : children
    })
    expect(labels).toContain('PERSIST CHECKLIST')
    expect(labels).toContain('Ignore battery: yes')
    expect(labels).not.toContain('Open Motorola Device Guard')
  })

  it('shows notifications needed when the checklist reports them ungranted', async () => {
    getPersistChecklistAsync.mockResolvedValueOnce({
      notificationsGranted: false,
      ignoringBattery: false,
      canOpenDeviceGuard: false,
      canDrawOverlays: false
    })
    const { renderer } = await renderPanel(basePrefs)
    const labels = renderer.root.findAllByType('Text').map((node) => {
      const children = node.props.children
      return Array.isArray(children) ? children.join('') : children
    })
    expect(labels).toContain('Notifications: needed')
    expect(labels).not.toContain('Notifications: granted')
  })

  it('requests overlay permission when the overlay switch turns on', async () => {
    const { renderer, onPrefsPatch } = await renderPanel(basePrefs)
    const overlay = switchForLabel(renderer.root, 'Overlay while speaking')
    expect(overlay).toBeDefined()
    await act(async () => {
      overlay?.props.onValueChange?.(true)
      await Promise.resolve()
    })
    expect(onPrefsPatch).toHaveBeenCalledWith({ overlayWhileSpeaking: true })
    expect(setPetSpeechOverlayWhileSpeaking).toHaveBeenCalledWith(true)
    expect(openPersistChecklistItemAsync).toHaveBeenCalledWith('overlay')
  })

  it('does not request overlay permission when the overlay switch turns off', async () => {
    const { renderer, onPrefsPatch } = await renderPanel({
      ...basePrefs,
      overlayWhileSpeaking: true
    })
    const overlay = switchForLabel(renderer.root, 'Overlay while speaking')
    await act(async () => {
      overlay?.props.onValueChange?.(false)
      await Promise.resolve()
    })
    expect(onPrefsPatch).toHaveBeenCalledWith({ overlayWhileSpeaking: false })
    expect(setPetSpeechOverlayWhileSpeaking).toHaveBeenCalledWith(false)
    expect(openPersistChecklistItemAsync).not.toHaveBeenCalled()
    expect(updatePersistSettingsAsync).toHaveBeenCalledWith(
      expect.objectContaining({ overlayWhileSpeaking: false })
    )
  })

  it('writes persist on and syncs when Keep after reboot turns on', async () => {
    const { renderer, onPrefsPatch } = await renderPanel(basePrefs)
    const persist = switchForLabel(renderer.root, 'Keep after reboot')
    await act(async () => {
      persist?.props.onValueChange?.(true)
      await Promise.resolve()
    })
    expect(onPrefsPatch).toHaveBeenCalledWith({ persistEnabled: true })
    expect(setPetSpeechPersistEnabled).toHaveBeenCalledWith(true)
    expect(updatePersistSettingsAsync).toHaveBeenCalledWith(
      expect.objectContaining({ persistEnabled: true })
    )
  })

  it('writes persist off and syncs when Keep after reboot turns off', async () => {
    const { renderer, onPrefsPatch } = await renderPanel({
      ...basePrefs,
      persistEnabled: true
    })
    const persist = switchForLabel(renderer.root, 'Keep after reboot')
    await act(async () => {
      persist?.props.onValueChange?.(false)
      await Promise.resolve()
    })
    expect(onPrefsPatch).toHaveBeenCalledWith({ persistEnabled: false })
    expect(setPetSpeechPersistEnabled).toHaveBeenCalledWith(false)
    expect(updatePersistSettingsAsync).toHaveBeenCalledWith(
      expect.objectContaining({ persistEnabled: false })
    )
  })

  it('writes keep-host when persist is on and the switch is enabled', async () => {
    const { renderer, onPrefsPatch } = await renderPanel({
      ...basePrefs,
      persistEnabled: true,
      keepHostConnection: false
    })
    const keepHost = switchForLabel(renderer.root, 'Keep host connection')
    expect(keepHost?.props.disabled).toBeFalsy()
    await act(async () => {
      keepHost?.props.onValueChange?.(true)
      await Promise.resolve()
    })
    expect(onPrefsPatch).toHaveBeenCalledWith({ keepHostConnection: true })
    expect(setPetSpeechKeepHostConnection).toHaveBeenCalledWith(true)
    expect(updatePersistSettingsAsync).toHaveBeenCalledWith(
      expect.objectContaining({ persistEnabled: true })
    )
    expect(updatePersistSettingsAsync.mock.calls.at(-1)?.[0]).not.toHaveProperty(
      'keepHostConnection'
    )
  })

  it('writes keep-host off when persist is on', async () => {
    const { renderer, onPrefsPatch } = await renderPanel({
      ...basePrefs,
      persistEnabled: true,
      keepHostConnection: true
    })
    const keepHost = switchForLabel(renderer.root, 'Keep host connection')
    await act(async () => {
      keepHost?.props.onValueChange?.(false)
      await Promise.resolve()
    })
    expect(onPrefsPatch).toHaveBeenCalledWith({ keepHostConnection: false })
    expect(setPetSpeechKeepHostConnection).toHaveBeenCalledWith(false)
    expect(updatePersistSettingsAsync).toHaveBeenCalledWith(
      expect.objectContaining({ persistEnabled: true })
    )
    expect(updatePersistSettingsAsync.mock.calls.at(-1)?.[0]).not.toHaveProperty(
      'keepHostConnection'
    )
  })

  it('writes keep-when-no-host when persist is on and the switch is enabled', async () => {
    const { renderer, onPrefsPatch } = await renderPanel({
      ...basePrefs,
      persistEnabled: true,
      keepWhenNoHost: false
    })
    const keepIdle = switchForLabel(renderer.root, 'Keep when no host')
    expect(keepIdle?.props.disabled).toBeFalsy()
    await act(async () => {
      keepIdle?.props.onValueChange?.(true)
      await Promise.resolve()
    })
    expect(onPrefsPatch).toHaveBeenCalledWith({ keepWhenNoHost: true })
    expect(setPetSpeechKeepWhenNoHost).toHaveBeenCalledWith(true)
    expect(updatePersistSettingsAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        persistEnabled: true,
        keepWhenNoHost: true
      })
    )
  })

  it('writes keep-when-no-host off when persist is on', async () => {
    const { renderer, onPrefsPatch } = await renderPanel({
      ...basePrefs,
      persistEnabled: true,
      keepWhenNoHost: true
    })
    const keepIdle = switchForLabel(renderer.root, 'Keep when no host')
    await act(async () => {
      keepIdle?.props.onValueChange?.(false)
      await Promise.resolve()
    })
    expect(onPrefsPatch).toHaveBeenCalledWith({ keepWhenNoHost: false })
    expect(setPetSpeechKeepWhenNoHost).toHaveBeenCalledWith(false)
    expect(updatePersistSettingsAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        persistEnabled: true,
        keepWhenNoHost: false
      })
    )
  })

  it('does not write keep-when-no-host when persist is off', async () => {
    const { renderer, onPrefsPatch } = await renderPanel({
      ...basePrefs,
      persistEnabled: false,
      keepWhenNoHost: false
    })
    const keepIdle = switchForLabel(renderer.root, 'Keep when no host')
    expect(keepIdle?.props.disabled).toBe(true)
    await act(async () => {
      keepIdle?.props.onValueChange?.(true)
      await Promise.resolve()
    })
    expect(onPrefsPatch).not.toHaveBeenCalled()
    expect(setPetSpeechKeepWhenNoHost).not.toHaveBeenCalled()
    expect(updatePersistSettingsAsync).not.toHaveBeenCalled()
  })

  it('does not write keep-host when persist is off', async () => {
    const { renderer, onPrefsPatch } = await renderPanel({
      ...basePrefs,
      persistEnabled: false,
      keepHostConnection: false
    })
    const keepHost = switchForLabel(renderer.root, 'Keep host connection')
    expect(keepHost?.props.disabled).toBe(true)
    await act(async () => {
      keepHost?.props.onValueChange?.(true)
      await Promise.resolve()
    })
    expect(onPrefsPatch).not.toHaveBeenCalled()
    expect(setPetSpeechKeepHostConnection).not.toHaveBeenCalled()
    expect(updatePersistSettingsAsync).not.toHaveBeenCalled()
  })

  it('writes show-service-status-row from the rendered persist panel', async () => {
    const { renderer, onPrefsPatch } = await renderPanel({
      ...basePrefs,
      persistEnabled: true,
      showServiceStatusRow: true
    })
    const serviceRow = switchForLabel(renderer.root, 'Show service status row')
    expect(serviceRow?.props.disabled).toBeFalsy()
    await act(async () => {
      serviceRow?.props.onValueChange?.(false)
      await Promise.resolve()
    })
    expect(onPrefsPatch).toHaveBeenCalledWith({ showServiceStatusRow: false })
    expect(setPetSpeechShowServiceStatusRow).toHaveBeenCalledWith(false)
    expect(updatePersistSettingsAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        persistEnabled: true,
        showServiceStatusRow: false
      })
    )
  })

  it('writes show-service-status-row on from the rendered persist panel', async () => {
    const { renderer, onPrefsPatch } = await renderPanel({
      ...basePrefs,
      persistEnabled: true,
      showServiceStatusRow: false
    })
    const serviceRow = switchForLabel(renderer.root, 'Show service status row')
    await act(async () => {
      serviceRow?.props.onValueChange?.(true)
      await Promise.resolve()
    })
    expect(onPrefsPatch).toHaveBeenCalledWith({ showServiceStatusRow: true })
    expect(setPetSpeechShowServiceStatusRow).toHaveBeenCalledWith(true)
    expect(updatePersistSettingsAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        persistEnabled: true,
        showServiceStatusRow: true
      })
    )
  })

  it('opens checklist items from the rendered Android rows', async () => {
    const { renderer } = await renderPanel(basePrefs)
    const press = async (labelText: string) => {
      const label = renderer.root.findAllByType('Text').find((node) => {
        const children = node.props.children
        const text = Array.isArray(children) ? children.join('') : children
        return text === labelText
      })
      await act(async () => {
        label?.parent?.props.onPress?.()
        await Promise.resolve()
      })
    }
    await press('Notifications: granted')
    expect(openPersistChecklistItemAsync).toHaveBeenCalledWith('notifications')
    await press('Ignore battery: open settings')
    expect(openPersistChecklistItemAsync).toHaveBeenCalledWith('battery')
    await press('Show Pet voice on lock screen')
    expect(openPersistChecklistItemAsync).toHaveBeenCalledWith('lock-channel')
    await press('Open Motorola Device Guard')
    expect(openPersistChecklistItemAsync).toHaveBeenCalledWith('device-guard')
  })

  it('reloads the checklist when AppState becomes active', async () => {
    await renderPanel(basePrefs)
    const afterMount = getPersistChecklistAsync.mock.calls.length
    expect(afterMount).toBeGreaterThanOrEqual(1)
    await act(async () => {
      for (const cb of appStateCallbacks) {
        cb('active')
      }
      await Promise.resolve()
    })
    expect(getPersistChecklistAsync.mock.calls.length).toBeGreaterThan(afterMount)
  })

  it('hides the persist checklist on iOS', async () => {
    platform.OS = 'ios'
    const { renderer } = await renderPanel(basePrefs)
    const labels = renderer.root.findAllByType('Text').map((node) => {
      const children = node.props.children
      return Array.isArray(children) ? children.join('') : children
    })
    expect(labels).toContain('PERSIST')
    expect(labels).not.toContain('PERSIST CHECKLIST')
  })
})
