import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

export function resolveAndroidSdkTools(customToolsDir = null) {
  if (typeof customToolsDir === 'string' && customToolsDir.length > 0) {
    if (existsSync(customToolsDir)) {
      const aapt2 = join(customToolsDir, 'aapt2')
      const apksigner = join(customToolsDir, 'apksigner')
      if (existsSync(aapt2) && existsSync(apksigner)) {
        return { aapt2, apksigner }
      }
    }
    throw new Error(
      'Failed to resolve required Android build tools (aapt2, apksigner). Set ANDROID_HOME or ANDROID_SDK_ROOT to an Android SDK installation with build-tools.'
    )
  }

  const sdkRoot = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT
  if (sdkRoot && existsSync(sdkRoot)) {
    const buildToolsDir = join(sdkRoot, 'build-tools')
    if (existsSync(buildToolsDir)) {
      const versions = readdirSync(buildToolsDir).sort().toReversed()
      for (const version of versions) {
        const dir = join(buildToolsDir, version)
        const aapt2 = join(dir, 'aapt2')
        const apksigner = join(dir, 'apksigner')
        if (existsSync(aapt2) && existsSync(apksigner)) {
          return { aapt2, apksigner }
        }
      }
    }
  }

  throw new Error(
    'Failed to resolve required Android build tools (aapt2, apksigner). Set ANDROID_HOME or ANDROID_SDK_ROOT to an Android SDK installation with build-tools.'
  )
}

export function inspectAndroidApk({
  apkPath,
  expectedPackage,
  expectedVersion,
  expectedVersionCode,
  debugKeystorePath = null,
  customTools = null,
  keytoolRunner = null
}) {
  if (!existsSync(apkPath)) {
    throw new Error(`APK file not found: ${apkPath}`)
  }

  const tools = customTools || resolveAndroidSdkTools()
  const { aapt2, apksigner } = tools

  // 1. aapt2 dump badging
  const badgingOutput = execFileSync(aapt2, ['dump', 'badging', apkPath], { encoding: 'utf8' })

  const pkgMatch = badgingOutput.match(
    /package:\s+name='([^']+)'\s+versionCode='([^']+)'\s+versionName='([^']+)'/
  )
  if (!pkgMatch) {
    throw new Error(`Failed to parse package metadata from aapt2 badging output:\n${badgingOutput}`)
  }

  const observedPackage = pkgMatch[1]
  const observedVersionCode = Number(pkgMatch[2])
  const observedVersion = pkgMatch[3]

  if (observedPackage !== expectedPackage) {
    throw new Error(
      `Package name mismatch: expected '${expectedPackage}', observed '${observedPackage}'`
    )
  }
  if (observedVersion !== expectedVersion) {
    throw new Error(
      `Version name mismatch: expected '${expectedVersion}', observed '${observedVersion}'`
    )
  }
  if (observedVersionCode !== Number(expectedVersionCode)) {
    throw new Error(
      `VersionCode mismatch: expected ${expectedVersionCode}, observed ${observedVersionCode}`
    )
  }

  // 2. aapt2 dump xmltree AndroidManifest.xml
  const xmlTreeOutput = execFileSync(
    aapt2,
    ['dump', 'xmltree', apkPath, '--file', 'AndroidManifest.xml'],
    {
      encoding: 'utf8'
    }
  )

  const hasForegroundServicePerm =
    xmlTreeOutput.includes('android.permission.FOREGROUND_SERVICE') ||
    badgingOutput.includes("uses-permission: name='android.permission.FOREGROUND_SERVICE'")
  if (!hasForegroundServicePerm) {
    throw new Error('Missing required permission: android.permission.FOREGROUND_SERVICE')
  }

  const hasMediaPlaybackPerm =
    xmlTreeOutput.includes('android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK') ||
    badgingOutput.includes(
      "uses-permission: name='android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK'"
    )
  if (!hasMediaPlaybackPerm) {
    throw new Error(
      'Missing required permission: android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK'
    )
  }

  // Verify exact PetSpeech foreground service stanza contains mediaPlayback foregroundServiceType
  const serviceRegex =
    /E:\s+service\s+\(line=\d+\)(?:(?!\n\s*E:\s+service)[\s\S])*?android:name\([^)]+\)="expo\.modules\.petspeech\.PetSpeechForegroundService"(?:(?!\n\s*E:\s+service)[\s\S])*?android:foregroundServiceType\([^)]+\)=(?:0x00000002|"mediaPlayback"|0x2)/m
  const serviceRegexAlt =
    /E:\s+service\s+\(line=\d+\)(?:(?!\n\s*E:\s+service)[\s\S])*?android:foregroundServiceType\([^)]+\)=(?:0x00000002|"mediaPlayback"|0x2)(?:(?!\n\s*E:\s+service)[\s\S])*?android:name\([^)]+\)="expo\.modules\.petspeech\.PetSpeechForegroundService"/m

  const hasPetSpeechServiceStanza =
    serviceRegex.test(xmlTreeOutput) || serviceRegexAlt.test(xmlTreeOutput)

  if (!hasPetSpeechServiceStanza) {
    if (!xmlTreeOutput.includes('expo.modules.petspeech.PetSpeechForegroundService')) {
      throw new Error('Missing required service: expo.modules.petspeech.PetSpeechForegroundService')
    }
    throw new Error(
      'PetSpeechForegroundService stanza missing required android:foregroundServiceType="mediaPlayback" (0x00000002)'
    )
  }

  // 3. apksigner verify --print-certs
  const certsOutput = execFileSync(apksigner, ['verify', '--verbose', '--print-certs', apkPath], {
    encoding: 'utf8'
  })

  const sha256Match = certsOutput.match(
    /(?:Signer #\d+|V2 Signer):? certificate SHA-256 digest:\s+([0-9a-fA-F]+)/i
  )
  if (!sha256Match) {
    throw new Error(
      `Failed to extract Signer certificate SHA-256 digest from apksigner output:\n${certsOutput}`
    )
  }
  const observedCertDigest = sha256Match[1].toLowerCase()

  const dnMatch = certsOutput.match(/(?:Signer #\d+|V2 Signer):? certificate DN:\s+([^\n]+)/)
  const observedCertDn = dnMatch ? dnMatch[1].trim() : ''

  if (debugKeystorePath && existsSync(debugKeystorePath)) {
    const runKeytool =
      keytoolRunner || ((args) => execFileSync('keytool', args, { encoding: 'utf8' }))
    const keytoolOutput = runKeytool([
      '-list',
      '-v',
      '-keystore',
      debugKeystorePath,
      '-alias',
      'androiddebugkey',
      '-storepass',
      'android'
    ])
    const expectedSha256Match = keytoolOutput.match(/SHA256:\s+([0-9A-Fa-f:]+)/)
    if (!expectedSha256Match) {
      throw new Error(
        `Failed to extract SHA256 from debug.keystore with keytool:\n${keytoolOutput}`
      )
    }
    const expectedCertDigest = expectedSha256Match[1].replace(/:/g, '').toLowerCase()
    if (observedCertDigest !== expectedCertDigest) {
      throw new Error(
        `APK signer certificate SHA-256 (${observedCertDigest}) does not match debug.keystore (${expectedCertDigest})`
      )
    }
  } else if (
    !observedCertDn.includes('Android Debug') &&
    !certsOutput.includes('CN=Android Debug')
  ) {
    throw new Error(`APK is not signed with debug/development key. Observed DN: ${observedCertDn}`)
  }

  return {
    package: observedPackage,
    version: observedVersion,
    versionCode: observedVersionCode,
    signerDigestSha256: observedCertDigest,
    signerDn: observedCertDn,
    signingMode: 'debug-keystore',
    verifiedPermissions: [
      'android.permission.FOREGROUND_SERVICE',
      'android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK'
    ],
    verifiedService: 'expo.modules.petspeech.PetSpeechForegroundService',
    foregroundServiceType: 'mediaPlayback',
    inspectedAt: new Date().toISOString()
  }
}

if (process.argv[1] && process.argv[1].endsWith('inspect-android-apk.mjs')) {
  const { readFileSync, writeFileSync } = await import('node:fs')
  const [apkPath, expectedPkg, expectedVer, expectedCode, debugKeystorePath, outMetaPath] =
    process.argv.slice(2)

  const mobileAppJson = JSON.parse(readFileSync('mobile/app.json', 'utf8'))
  const pkg = expectedPkg || mobileAppJson.expo.android.package
  const ver = expectedVer || mobileAppJson.expo.version
  const code = expectedCode || mobileAppJson.expo.android.versionCode

  const result = inspectAndroidApk({
    apkPath,
    expectedPackage: pkg,
    expectedVersion: ver,
    expectedVersionCode: code,
    debugKeystorePath: debugKeystorePath || 'mobile/android/app/debug.keystore'
  })

  if (outMetaPath) {
    writeFileSync(outMetaPath, JSON.stringify(result, null, 2), 'utf8')
  }
  console.log(JSON.stringify(result, null, 2))
}
