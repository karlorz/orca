import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { writeFileSync, unlinkSync } from 'node:fs'
import path from 'node:path'

const scriptPath = path.resolve(import.meta.dirname, '../../scripts/verify-pet-speech-manifest.mjs')

describe('verify-pet-speech-manifest CLI script', () => {
  it('exits with code 1 when target manifest file is missing', () => {
    const nonExistentPath = path.resolve(import.meta.dirname, 'non_existent_manifest.xml')
    const result = spawnSync('node', [scriptPath, nonExistentPath], { encoding: 'utf8' })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('AndroidManifest file not found')
  })

  it('exits with code 1 when invoked with npm/pnpm conventional delimiter -- and file is missing', () => {
    const nonExistentPath = path.resolve(import.meta.dirname, 'non_existent_manifest.xml')
    const result = spawnSync('node', [scriptPath, '--', nonExistentPath], { encoding: 'utf8' })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('AndroidManifest file not found')
  })

  it('exits with code 1 when manifest XML is invalid (missing permissions/service)', () => {
    const invalidXml = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.stably.orca.mobile">
    <application></application>
</manifest>`
    const tempFile = path.resolve(import.meta.dirname, 'temp_invalid_manifest.xml')
    try {
      writeFileSync(tempFile, invalidXml, 'utf8')
      const result = spawnSync('node', [scriptPath, tempFile], { encoding: 'utf8' })
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('Manifest validation failed')
      expect(result.stderr).toContain('Missing requirements')
    } finally {
      try {
        unlinkSync(tempFile)
      } catch {}
    }
  })

  it('exits with code 0 when manifest XML contains all required permissions and mediaPlayback service (with -- delimiter)', () => {
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
    const tempFile = path.resolve(import.meta.dirname, 'temp_valid_manifest.xml')
    try {
      writeFileSync(tempFile, validXml, 'utf8')
      const result = spawnSync('node', [scriptPath, '--', tempFile], { encoding: 'utf8' })
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('Success: Valid pet speech foreground mediaPlayback manifest')
    } finally {
      try {
        unlinkSync(tempFile)
      } catch {}
    }
  })
})
