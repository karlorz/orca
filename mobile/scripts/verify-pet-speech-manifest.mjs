import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

export function validateMergedAndroidManifest(manifestXmlContent) {
  const missing = []

  const hasForegroundService =
    manifestXmlContent.includes('android:name="android.permission.FOREGROUND_SERVICE"') ||
    manifestXmlContent.includes("android:name='android.permission.FOREGROUND_SERVICE'")

  if (!hasForegroundService) {
    missing.push('android.permission.FOREGROUND_SERVICE')
  }

  const hasForegroundMediaPlayback =
    manifestXmlContent.includes(
      'android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK"'
    ) ||
    manifestXmlContent.includes(
      "android:name='android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK'"
    )

  if (!hasForegroundMediaPlayback) {
    missing.push('android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK')
  }

  const hasServiceClass =
    manifestXmlContent.includes(
      'android:name="expo.modules.petspeech.PetSpeechForegroundService"'
    ) ||
    manifestXmlContent.includes(
      "android:name='expo.modules.petspeech.PetSpeechForegroundService'"
    ) ||
    manifestXmlContent.includes('android:name=".PetSpeechForegroundService"') ||
    manifestXmlContent.includes("android:name='.PetSpeechForegroundService'")

  if (!hasServiceClass) {
    missing.push('expo.modules.petspeech.PetSpeechForegroundService')
  }

  const hasMediaPlaybackType =
    manifestXmlContent.includes('android:foregroundServiceType="mediaPlayback"') ||
    manifestXmlContent.includes("android:foregroundServiceType='mediaPlayback'")

  if (!hasMediaPlaybackType) {
    missing.push('foregroundServiceType="mediaPlayback"')
  }

  return {
    isValid: missing.length === 0,
    missingRequirements: missing
  }
}

function main() {
  const rawArgs = process.argv.slice(2)
  const explicitPath = rawArgs.find((arg) => arg !== '--')
  const defaultPath = path.resolve(
    import.meta.dirname,
    '../android/app/build/intermediates/merged_manifests/debug/processDebugManifest/AndroidManifest.xml'
  )
  const targetPath = explicitPath || defaultPath

  if (!existsSync(targetPath)) {
    console.error(
      `[verify:pet-speech-manifest] Error: AndroidManifest file not found at ${targetPath}`
    )
    process.exit(1)
  }

  const manifestContent = readFileSync(targetPath, 'utf8')
  const validation = validateMergedAndroidManifest(manifestContent)

  if (!validation.isValid) {
    console.error(
      `[verify:pet-speech-manifest] Error: Manifest validation failed for ${targetPath}`
    )
    console.error(`Missing requirements: ${validation.missingRequirements.join(', ')}`)
    process.exit(1)
  }

  console.log(
    `[verify:pet-speech-manifest] Success: Valid pet speech foreground mediaPlayback manifest at ${targetPath}`
  )
  process.exit(0)
}

if (process.argv[1] && process.argv[1].endsWith('verify-pet-speech-manifest.mjs')) {
  main()
}
