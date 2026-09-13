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

  const hasRequestIgnoreBatteryOptimizations =
    manifestXmlContent.includes(
      'android:name="android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS"'
    ) ||
    manifestXmlContent.includes(
      "android:name='android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS'"
    )

  if (!hasRequestIgnoreBatteryOptimizations) {
    missing.push('android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS')
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

  const hasStopWithTaskFalse =
    manifestXmlContent.includes('android:stopWithTask="false"') ||
    manifestXmlContent.includes("android:stopWithTask='false'")

  if (!hasStopWithTaskFalse) {
    missing.push('stopWithTask="false"')
  }

  const forbidden = [
    'ROLE_CALL_SCREENING',
    'ROLE_DIALER',
    'BIND_NOTIFICATION_LISTENER_SERVICE',
    'BIND_DEVICE_ADMIN',
    'android.app.admin.DeviceAdminReceiver'
  ]
  for (const token of forbidden) {
    if (manifestXmlContent.includes(token)) {
      missing.push(`forbidden:${token}`)
    }
  }

  return {
    isValid: missing.length === 0,
    missingRequirements: missing
  }
}
