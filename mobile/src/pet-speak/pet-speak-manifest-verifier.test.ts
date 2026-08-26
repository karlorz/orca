import { describe, expect, it } from 'vitest'
import { validateMergedAndroidManifest } from './pet-speak-manifest-verifier'

describe('validateMergedAndroidManifest', () => {
  it('passes when valid manifest XML contains permissions, mediaPlayback service, and stopWithTask=false', () => {
    const validXml = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.stably.orca.mobile">
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK" />
    <uses-permission android:name="android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS" />
    <application>
        <service
            android:name="expo.modules.petspeech.PetSpeechForegroundService"
            android:exported="false"
            android:stopWithTask="false"
            android:foregroundServiceType="mediaPlayback" />
    </application>
</manifest>`

    const result = validateMergedAndroidManifest(validXml)
    expect(result.isValid).toBe(true)
    expect(result.missingRequirements).toEqual([])
  })

  it('fails when REQUEST_IGNORE_BATTERY_OPTIMIZATIONS is missing', () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.stably.orca.mobile">
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK" />
    <application>
        <service
            android:name="expo.modules.petspeech.PetSpeechForegroundService"
            android:exported="false"
            android:stopWithTask="false"
            android:foregroundServiceType="mediaPlayback" />
    </application>
</manifest>`

    const result = validateMergedAndroidManifest(xml)
    expect(result.isValid).toBe(false)
    expect(result.missingRequirements).toContain(
      'android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS'
    )
  })

  it('fails when stopWithTask="false" is missing', () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.stably.orca.mobile">
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK" />
    <uses-permission android:name="android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS" />
    <application>
        <service
            android:name="expo.modules.petspeech.PetSpeechForegroundService"
            android:exported="false"
            android:foregroundServiceType="mediaPlayback" />
    </application>
</manifest>`

    const result = validateMergedAndroidManifest(xml)
    expect(result.isValid).toBe(false)
    expect(result.missingRequirements).toContain('stopWithTask="false"')
  })

  it('fails when FOREGROUND_SERVICE is missing', () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.stably.orca.mobile">
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK" />
    <application>
        <service
            android:name="expo.modules.petspeech.PetSpeechForegroundService"
            android:exported="false"
            android:foregroundServiceType="mediaPlayback" />
    </application>
</manifest>`

    const result = validateMergedAndroidManifest(xml)
    expect(result.isValid).toBe(false)
    expect(result.missingRequirements).toContain('android.permission.FOREGROUND_SERVICE')
  })

  it('fails when FOREGROUND_SERVICE_MEDIA_PLAYBACK is missing', () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.stably.orca.mobile">
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
    <application>
        <service
            android:name="expo.modules.petspeech.PetSpeechForegroundService"
            android:exported="false"
            android:foregroundServiceType="mediaPlayback" />
    </application>
</manifest>`

    const result = validateMergedAndroidManifest(xml)
    expect(result.isValid).toBe(false)
    expect(result.missingRequirements).toContain(
      'android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK'
    )
  })

  it('fails when service class is missing', () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.stably.orca.mobile">
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK" />
    <application>
    </application>
</manifest>`

    const result = validateMergedAndroidManifest(xml)
    expect(result.isValid).toBe(false)
    expect(result.missingRequirements).toContain(
      'expo.modules.petspeech.PetSpeechForegroundService'
    )
  })

  it('fails when service is missing foregroundServiceType="mediaPlayback"', () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.stably.orca.mobile">
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK" />
    <application>
        <service
            android:name="expo.modules.petspeech.PetSpeechForegroundService"
            android:exported="false" />
    </application>
</manifest>`

    const result = validateMergedAndroidManifest(xml)
    expect(result.isValid).toBe(false)
    expect(result.missingRequirements).toContain('foregroundServiceType="mediaPlayback"')
  })
})
