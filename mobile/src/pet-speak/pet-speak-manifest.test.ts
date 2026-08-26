import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const dirname = import.meta.dirname
const moduleManifestPath = path.resolve(
  dirname,
  '../../packages/expo-pet-speech/android/src/main/AndroidManifest.xml'
)
const expoModuleConfigPath = path.resolve(
  dirname,
  '../../packages/expo-pet-speech/expo-module.config.json'
)

describe('expo-pet-speech module source manifest and autolinking configuration', () => {
  it('declares FOREGROUND_SERVICE, FOREGROUND_SERVICE_MEDIA_PLAYBACK, and REQUEST_IGNORE_BATTERY_OPTIMIZATIONS permissions and mediaPlayback service with stopWithTask=false in package source', () => {
    expect(existsSync(moduleManifestPath)).toBe(true)
    const content = readFileSync(moduleManifestPath, 'utf8')

    expect(content).toContain(
      '<uses-permission android:name="android.permission.FOREGROUND_SERVICE"'
    )
    expect(content).toContain(
      '<uses-permission android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK"'
    )
    expect(content).toContain(
      '<uses-permission android:name="android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS"'
    )
    expect(content).toContain('android:name=".PetSpeechForegroundService"')
    expect(content).toContain('android:foregroundServiceType="mediaPlayback"')
    expect(content).toContain('android:exported="false"')
    expect(content).toContain('android:stopWithTask="false"')
  })

  it('registers Android module correctly in expo-module.config.json', () => {
    expect(existsSync(expoModuleConfigPath)).toBe(true)
    const config = JSON.parse(readFileSync(expoModuleConfigPath, 'utf8'))
    expect(config.platforms).toEqual(['android'])
    expect(config.android.modules).toContain('expo.modules.petspeech.ExpoPetSpeechModule')
  })
})
