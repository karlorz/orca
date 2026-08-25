export interface ManifestValidationResult {
  isValid: boolean
  missingRequirements: string[]
}

export function validateMergedAndroidManifest(
  manifestXmlContent: string
): ManifestValidationResult {
  const missing: string[] = []

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
