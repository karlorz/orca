import { describe, expect, it, vi } from 'vitest'
import {
  resolvePetSpeechSetupAction,
  countMatchingPetSpeechVoices,
  petSpeechVoiceMatchesLanguage,
  openPetSpeechSetupAction,
  GOOGLE_TTS_MARKET_URL,
  GOOGLE_TTS_HTTPS_URL,
  TTS_SETTINGS_ACTION
} from './pet-speech-setup-action'
import type { PetSpeechVoice } from './pet-speak-native-adapter'

describe('resolvePetSpeechSetupAction', () => {
  it('returns none for non-android platforms regardless of voice counts', () => {
    expect(
      resolvePetSpeechSetupAction({
        platform: 'ios',
        catalogVoiceCount: 0,
        matchingVoiceCount: 0
      })
    ).toEqual({ kind: 'none' })

    expect(
      resolvePetSpeechSetupAction({
        platform: 'web',
        catalogVoiceCount: 0,
        matchingVoiceCount: 0
      })
    ).toEqual({ kind: 'none' })
  })

  it('returns install-engine when android has 0 catalog voices and 0 matching voices', () => {
    expect(
      resolvePetSpeechSetupAction({
        platform: 'android',
        catalogVoiceCount: 0,
        matchingVoiceCount: 0
      })
    ).toEqual({
      kind: 'install-engine',
      marketUrl: GOOGLE_TTS_MARKET_URL,
      httpsUrl: GOOGLE_TTS_HTTPS_URL
    })
  })

  it('returns open-tts-settings when android has >0 catalog voices but 0 matching voices', () => {
    expect(
      resolvePetSpeechSetupAction({
        platform: 'android',
        catalogVoiceCount: 5,
        matchingVoiceCount: 0
      })
    ).toEqual({
      kind: 'open-tts-settings',
      action: TTS_SETTINGS_ACTION
    })
  })

  it('returns none when android has >0 catalog voices and >0 matching voices', () => {
    expect(
      resolvePetSpeechSetupAction({
        platform: 'android',
        catalogVoiceCount: 5,
        matchingVoiceCount: 2
      })
    ).toEqual({ kind: 'none' })
  })
})

describe('countMatchingPetSpeechVoices and petSpeechVoiceMatchesLanguage', () => {
  const voices: PetSpeechVoice[] = [
    {
      name: 'yue-voice-1',
      locale: 'zh-HK',
      language: 'yue-HK',
      quality: 300,
      network: false
    },
    {
      name: 'yue-voice-2',
      locale: 'zh-HK',
      language: undefined,
      quality: 300,
      network: false
    },
    {
      name: 'en-voice-1',
      locale: 'en-US',
      language: 'en-US',
      quality: 300,
      network: false
    }
  ]

  it('petSpeechVoiceMatchesLanguage matches by canonical language or normalized locale', () => {
    expect(petSpeechVoiceMatchesLanguage(voices[0], 'yue-HK')).toBe(true)
    expect(petSpeechVoiceMatchesLanguage(voices[1], 'yue-HK')).toBe(true)
    expect(petSpeechVoiceMatchesLanguage(voices[2], 'yue-HK')).toBe(false)
    expect(petSpeechVoiceMatchesLanguage(voices[2], 'en-US')).toBe(true)
  })

  it('countMatchingPetSpeechVoices counts matching voices for canonical language', () => {
    expect(countMatchingPetSpeechVoices(voices, 'yue-HK')).toBe(2)
    expect(countMatchingPetSpeechVoices(voices, 'en-US')).toBe(1)
    expect(countMatchingPetSpeechVoices(voices, 'zh-CN')).toBe(0)
    expect(countMatchingPetSpeechVoices([], 'yue-HK')).toBe(0)
  })
})

describe('openPetSpeechSetupAction', () => {
  it('does nothing when action is none', async () => {
    const openURL = vi.fn().mockResolvedValue(true)
    const sendIntent = vi.fn().mockResolvedValue(true)
    const res = await openPetSpeechSetupAction({ kind: 'none' }, { openURL, sendIntent })

    expect(res).toEqual({ opened: 'none' })
    expect(openURL).not.toHaveBeenCalled()
    expect(sendIntent).not.toHaveBeenCalled()
  })

  it('opens marketUrl for install-engine when openURL succeeds', async () => {
    const openURL = vi.fn().mockResolvedValue(true)
    const res = await openPetSpeechSetupAction(
      {
        kind: 'install-engine',
        marketUrl: GOOGLE_TTS_MARKET_URL,
        httpsUrl: GOOGLE_TTS_HTTPS_URL
      },
      { openURL }
    )

    expect(res).toEqual({ opened: 'market' })
    expect(openURL).toHaveBeenCalledTimes(1)
    expect(openURL).toHaveBeenCalledWith(GOOGLE_TTS_MARKET_URL)
  })

  it('falls back to httpsUrl for install-engine when marketUrl rejects', async () => {
    const openURL = vi
      .fn()
      .mockRejectedValueOnce(new Error('No market app'))
      .mockResolvedValueOnce(true)

    const res = await openPetSpeechSetupAction(
      {
        kind: 'install-engine',
        marketUrl: GOOGLE_TTS_MARKET_URL,
        httpsUrl: GOOGLE_TTS_HTTPS_URL
      },
      { openURL }
    )

    expect(res).toEqual({ opened: 'https' })
    expect(openURL).toHaveBeenCalledTimes(2)
    expect(openURL).toHaveBeenNthCalledWith(1, GOOGLE_TTS_MARKET_URL)
    expect(openURL).toHaveBeenNthCalledWith(2, GOOGLE_TTS_HTTPS_URL)
  })

  it('calls sendIntent for open-tts-settings when sendIntent succeeds', async () => {
    const openURL = vi.fn()
    const sendIntent = vi.fn().mockResolvedValue(true)

    const res = await openPetSpeechSetupAction(
      { kind: 'open-tts-settings', action: TTS_SETTINGS_ACTION },
      { openURL, sendIntent }
    )

    expect(res).toEqual({ opened: 'tts-settings' })
    expect(sendIntent).toHaveBeenCalledWith(TTS_SETTINGS_ACTION)
    expect(openURL).not.toHaveBeenCalled()
  })

  it('falls back to market then https URL when sendIntent is missing or rejects', async () => {
    const openURL = vi.fn().mockResolvedValue(true)
    const sendIntent = vi.fn().mockRejectedValue(new Error('ActivityNotFoundException'))

    const res = await openPetSpeechSetupAction(
      { kind: 'open-tts-settings', action: TTS_SETTINGS_ACTION },
      { openURL, sendIntent }
    )

    expect(res).toEqual({ opened: 'market' })
    expect(sendIntent).toHaveBeenCalledWith(TTS_SETTINGS_ACTION)
    expect(openURL).toHaveBeenCalledWith(GOOGLE_TTS_MARKET_URL)
  })

  it('falls back to https URL when sendIntent rejects and marketUrl also rejects', async () => {
    const openURL = vi
      .fn()
      .mockRejectedValueOnce(new Error('No market app'))
      .mockResolvedValueOnce(true)
    const sendIntent = vi.fn().mockRejectedValue(new Error('ActivityNotFoundException'))

    const res = await openPetSpeechSetupAction(
      { kind: 'open-tts-settings', action: TTS_SETTINGS_ACTION },
      { openURL, sendIntent }
    )

    expect(res).toEqual({ opened: 'https' })
    expect(sendIntent).toHaveBeenCalledWith(TTS_SETTINGS_ACTION)
    expect(openURL).toHaveBeenNthCalledWith(1, GOOGLE_TTS_MARKET_URL)
    expect(openURL).toHaveBeenNthCalledWith(2, GOOGLE_TTS_HTTPS_URL)
  })

  it('falls back to market URL when sendIntent function is not provided on linking', async () => {
    const openURL = vi.fn().mockResolvedValue(true)

    const res = await openPetSpeechSetupAction(
      { kind: 'open-tts-settings', action: TTS_SETTINGS_ACTION },
      { openURL }
    )

    expect(res).toEqual({ opened: 'market' })
    expect(openURL).toHaveBeenCalledWith(GOOGLE_TTS_MARKET_URL)
  })
})
