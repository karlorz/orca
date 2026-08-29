import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AndroidPetSpeechAdapter, getPetSpeechNativeAdapter } from './pet-speak-native-adapter'
import type { PetSpeakPayload } from './pet-speak-payload-validation'
import type { PetSpeechNativeModule } from '@orca/expo-pet-speech'

vi.mock('react-native', () => ({
  Platform: { OS: 'android', Version: 34 }
}))

describe('AndroidPetSpeechAdapter', () => {
  let mockNativeModule: {
    speakAsync: ReturnType<typeof vi.fn>
    stopAsync: ReturnType<typeof vi.fn>
    getAvailableVoicesAsync: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockNativeModule = {
      speakAsync: vi.fn(),
      stopAsync: vi.fn(),
      getAvailableVoicesAsync: vi.fn()
    }
  })

  it('rejects oversized text or invalid payload before reaching native layer', async () => {
    const adapter = new AndroidPetSpeechAdapter(
      mockNativeModule as unknown as PetSpeechNativeModule
    )
    const longText = '長'.repeat(71)
    const payload: PetSpeakPayload = {
      type: 'pet.speak',
      text: longText,
      lang: 'yue',
      event_id: 'ev-oversize'
    }

    const outcome = await adapter.speak(payload)
    expect(outcome).toBe('playback-error')
    expect(mockNativeModule.speakAsync).not.toHaveBeenCalled()
  })

  it('delegates valid utterance to native module speakAsync and returns bounded outcome', async () => {
    mockNativeModule.speakAsync.mockResolvedValueOnce({ outcome: 'spoken' })
    const adapter = new AndroidPetSpeechAdapter(
      mockNativeModule as unknown as PetSpeechNativeModule
    )
    const payload: PetSpeakPayload = {
      type: 'pet.speak',
      text: '你好呀',
      lang: 'yue',
      event_id: 'ev-valid-1'
    }

    const outcome = await adapter.speak(payload)
    expect(mockNativeModule.speakAsync).toHaveBeenCalledWith({
      eventId: 'ev-valid-1',
      text: '你好呀',
      lang: 'yue',
      rate: 1.2,
      voiceName: undefined,
      debug: undefined
    })
    expect(outcome).toBe('spoken')
  })

  it('passes clamped custom rate, voiceName, and debug to native speakAsync', async () => {
    mockNativeModule.speakAsync.mockResolvedValueOnce({ outcome: 'spoken' })
    const adapter = new AndroidPetSpeechAdapter(
      mockNativeModule as unknown as PetSpeechNativeModule
    )
    const outcome = await adapter.speak({
      type: 'pet.speak',
      text: '快啲',
      lang: 'yue',
      event_id: 'ev-rate',
      rate: 2,
      voiceName: 'yue-HK-language',
      debug: true
    })
    expect(mockNativeModule.speakAsync).toHaveBeenCalledWith({
      eventId: 'ev-rate',
      text: '快啲',
      lang: 'yue',
      rate: 2,
      voiceName: 'yue-HK-language',
      debug: true
    })
    expect(outcome).toBe('spoken')
  })

  it('returns voice-unavailable when native module indicates voice is missing', async () => {
    mockNativeModule.speakAsync.mockResolvedValueOnce({ outcome: 'voice-unavailable' })
    const adapter = new AndroidPetSpeechAdapter(
      mockNativeModule as unknown as PetSpeechNativeModule
    )
    const payload: PetSpeakPayload = {
      type: 'pet.speak',
      text: '無廣東話語音',
      lang: 'yue',
      event_id: 'ev-no-voice'
    }

    const outcome = await adapter.speak(payload)
    expect(outcome).toBe('voice-unavailable')
  })

  it('surfaces ForegroundServiceStartNotAllowedException / playback errors as playback-error', async () => {
    mockNativeModule.speakAsync.mockRejectedValueOnce(
      new Error(
        'ForegroundServiceStartNotAllowedException: Service cannot be started in background'
      )
    )
    const adapter = new AndroidPetSpeechAdapter(
      mockNativeModule as unknown as PetSpeechNativeModule
    )
    const payload: PetSpeakPayload = {
      type: 'pet.speak',
      text: '後台錯誤',
      lang: 'yue',
      event_id: 'ev-bg-err'
    }

    const outcome = await adapter.speak(payload)
    expect(outcome).toBe('playback-error')
  })

  it('returns cancelled when native module is cancelled or returns cancelled outcome', async () => {
    mockNativeModule.speakAsync.mockResolvedValueOnce({ outcome: 'cancelled' })
    const adapter = new AndroidPetSpeechAdapter(
      mockNativeModule as unknown as PetSpeechNativeModule
    )
    const payload: PetSpeakPayload = {
      type: 'pet.speak',
      text: '取消語音',
      lang: 'yue',
      event_id: 'ev-cancel'
    }

    const outcome = await adapter.speak(payload)
    expect(outcome).toBe('cancelled')
  })

  it('calls stopAsync on native module when stop is invoked', async () => {
    mockNativeModule.stopAsync.mockResolvedValueOnce(undefined)
    const adapter = new AndroidPetSpeechAdapter(
      mockNativeModule as unknown as PetSpeechNativeModule
    )
    await adapter.stop()
    expect(mockNativeModule.stopAsync).toHaveBeenCalledTimes(1)
  })

  it('forwards acquireVoiceSessionAsync to native module', async () => {
    mockNativeModule.acquireVoiceSessionAsync = vi.fn().mockResolvedValueOnce({ held: true })
    const adapter = new AndroidPetSpeechAdapter(
      mockNativeModule as unknown as PetSpeechNativeModule
    )
    const result = await adapter.acquireVoiceSession()
    expect(mockNativeModule.acquireVoiceSessionAsync).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ held: true })
  })

  it('forwards releaseVoiceSessionAsync to native module', async () => {
    mockNativeModule.releaseVoiceSessionAsync = vi.fn().mockResolvedValueOnce(undefined)
    const adapter = new AndroidPetSpeechAdapter(
      mockNativeModule as unknown as PetSpeechNativeModule
    )
    await adapter.releaseVoiceSession()
    expect(mockNativeModule.releaseVoiceSessionAsync).toHaveBeenCalledTimes(1)
  })

  it('forwards updateVoiceSessionNotificationAsync to native module', async () => {
    mockNativeModule.updateVoiceSessionNotificationAsync = vi.fn().mockResolvedValueOnce(undefined)
    const adapter = new AndroidPetSpeechAdapter(
      mockNativeModule as unknown as PetSpeechNativeModule
    )
    await adapter.updateVoiceSessionNotification('Orca Pet — Reconnecting...')
    expect(mockNativeModule.updateVoiceSessionNotificationAsync).toHaveBeenCalledWith(
      'Orca Pet — Reconnecting...'
    )
  })

  it('getPetSpeechNativeAdapter returns AndroidPetSpeechAdapter on android and null on ios', () => {
    const androidAdapter = getPetSpeechNativeAdapter()
    expect(androidAdapter).toBeInstanceOf(AndroidPetSpeechAdapter)
  })
})
