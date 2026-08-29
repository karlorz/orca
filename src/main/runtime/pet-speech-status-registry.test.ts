import { describe, expect, it } from 'vitest'
import { PetSpeechDeviceRegistry } from './pet-speech-status-registry'

describe('PetSpeechDeviceRegistry', () => {
  it('updates or inserts a status row and persists stable UUID across updates', () => {
    const registry = new PetSpeechDeviceRegistry()
    registry.reportStatus(
      {
        installUuid: 'uuid-device-1',
        modelName: 'Pixel 8',
        enabled: true,
        availability: 'available',
        activeEngine: 'com.google.android.tts',
        supportedLanguages: ['yue-HK', 'en-US'],
        currentLanguage: 'yue-HK',
        selectedVoice: 'cmn-hk-x-f-local',
        rate: 1.2,
        lastOutcome: 'spoken'
      },
      'conn-1'
    )

    const row = registry.getStatus('uuid-device-1')
    expect(row).toBeDefined()
    expect(row?.installUuid).toBe('uuid-device-1')
    expect(row?.modelName).toBe('Pixel 8')
    expect(row?.enabled).toBe(true)
    expect(row?.availability).toBe('available')
    expect(row?.connected).toBe(true)
    expect(row?.connectionId).toBe('conn-1')
    expect(row?.activeEngine).toBe('com.google.android.tts')
    expect(row?.rate).toBe(1.2)

    // Update with same UUID, changing rate and outcome
    registry.reportStatus(
      {
        installUuid: 'uuid-device-1',
        modelName: 'Pixel 8',
        enabled: true,
        availability: 'available',
        rate: 1.5,
        lastOutcome: 'cancelled'
      },
      'conn-1'
    )

    const updated = registry.getStatus('uuid-device-1')
    expect(updated?.rate).toBe(1.5)
    expect(updated?.lastOutcome).toBe('cancelled')
    expect(updated?.activeEngine).toBe('com.google.android.tts') // retained or merged
  })

  it('keeps two devices with the same model name separate by UUID', () => {
    const registry = new PetSpeechDeviceRegistry()
    registry.reportStatus(
      {
        installUuid: 'uuid-phone-a',
        modelName: 'iPlay40',
        enabled: true,
        availability: 'available'
      },
      'conn-a'
    )

    registry.reportStatus(
      {
        installUuid: 'uuid-phone-b',
        modelName: 'iPlay40',
        enabled: false,
        availability: 'disabled'
      },
      'conn-b'
    )

    expect(registry.getAllStatuses()).toHaveLength(2)
    const phoneA = registry.getStatus('uuid-phone-a')
    const phoneB = registry.getStatus('uuid-phone-b')
    expect(phoneA?.enabled).toBe(true)
    expect(phoneA?.availability).toBe('available')
    expect(phoneB?.enabled).toBe(false)
    expect(phoneB?.availability).toBe('disabled')
  })

  it('renders enabled and disabled states distinctly with disabled reporting disabled/unavailable', () => {
    const registry = new PetSpeechDeviceRegistry()
    registry.reportStatus(
      {
        installUuid: 'uuid-disabled-device',
        modelName: 'Galaxy Tab',
        enabled: false,
        availability: 'disabled'
      },
      'conn-disabled'
    )

    const row = registry.getStatus('uuid-disabled-device')
    expect(row?.enabled).toBe(false)
    expect(row?.availability).toBe('disabled')
    expect(row?.selectedVoice).toBeUndefined()
  })

  it('strips live presentation fields when an enabled device reports disabled', () => {
    const registry = new PetSpeechDeviceRegistry()
    registry.reportStatus(
      {
        installUuid: 'uuid-1',
        modelName: 'iPlay40',
        enabled: true,
        availability: 'available',
        activeEngine: 'com.google.android.tts',
        supportedLanguages: ['yue-HK'],
        currentLanguage: 'yue-HK',
        selectedVoice: 'yue-voice',
        rate: 1.2,
        lastOutcome: 'spoken'
      },
      'conn-1'
    )
    registry.reportStatus(
      {
        installUuid: 'uuid-1',
        modelName: 'iPlay40',
        enabled: false,
        availability: 'disabled'
      },
      'conn-1'
    )
    const row = registry.getStatus('uuid-1')
    expect(row?.enabled).toBe(false)
    expect(row?.availability).toBe('disabled')
    expect(row?.activeEngine).toBeUndefined()
    expect(row?.supportedLanguages).toBeUndefined()
    expect(row?.currentLanguage).toBeUndefined()
    expect(row?.selectedVoice).toBeUndefined()
    expect(row?.rate).toBeUndefined()
    expect(row?.lastOutcome).toBeUndefined()
    expect(row?.connected).toBe(true)
  })

  it('cleans up only the matching connection without deleting row or affecting other devices', () => {
    const registry = new PetSpeechDeviceRegistry()
    registry.reportStatus(
      {
        installUuid: 'uuid-1',
        modelName: 'Device 1',
        enabled: true,
        availability: 'available'
      },
      'conn-1'
    )
    registry.reportStatus(
      {
        installUuid: 'uuid-2',
        modelName: 'Device 2',
        enabled: true,
        availability: 'available'
      },
      'conn-2'
    )

    registry.cleanupConnection('conn-1')

    const dev1 = registry.getStatus('uuid-1')
    const dev2 = registry.getStatus('uuid-2')

    expect(dev1?.connected).toBe(false)
    expect(dev1?.installUuid).toBe('uuid-1') // row not erased prematurely
    expect(dev2?.connected).toBe(true)
  })

  it('prevents stale connection cleanup from disconnecting a reconnected replacement for the same UUID', () => {
    const registry = new PetSpeechDeviceRegistry()
    // 1. First connection
    registry.reportStatus(
      {
        installUuid: 'uuid-1',
        modelName: 'Device 1',
        enabled: true,
        availability: 'available'
      },
      'conn-old'
    )

    // 2. Reconnect on new connection
    registry.reportStatus(
      {
        installUuid: 'uuid-1',
        modelName: 'Device 1',
        enabled: true,
        availability: 'available'
      },
      'conn-new'
    )

    expect(registry.getStatus('uuid-1')?.connectionId).toBe('conn-new')

    // 3. Stale cleanup arrives from old connection
    registry.cleanupConnection('conn-old')

    // Row should STILL be connected because it belongs to conn-new now
    expect(registry.getStatus('uuid-1')?.connected).toBe(true)
    expect(registry.getStatus('uuid-1')?.connectionId).toBe('conn-new')
  })
})
