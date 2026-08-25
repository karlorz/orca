import { describe, expect, it } from 'vitest'
import { mkdirSync, rmSync, writeFileSync, chmodSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { inspectAndroidApk, resolveAndroidSdkTools } from './inspect-android-apk.mjs'

const projectDir = resolve(import.meta.dirname, '../..')
const fixtureDir = join(projectDir, 'config/scripts/test-fixtures-apk')

function setupFakeTools({ badgingOutput, xmlTreeOutput, apksignerOutput }) {
  rmSync(fixtureDir, { recursive: true, force: true })
  mkdirSync(fixtureDir, { recursive: true })

  const fakeAapt2 = join(fixtureDir, 'aapt2')
  const fakeApksigner = join(fixtureDir, 'apksigner')
  const fakeApk = join(fixtureDir, 'test.apk')
  const fakeKeystore = join(fixtureDir, 'debug.keystore')

  writeFileSync(fakeApk, 'fake-apk-binary-content')
  writeFileSync(fakeKeystore, 'fake-keystore-content')

  const aapt2Script = `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === 'dump' && args[1] === 'badging') {
  process.stdout.write(${JSON.stringify(badgingOutput)});
  process.exit(0);
}
if (args[0] === 'dump' && args[1] === 'xmltree') {
  process.stdout.write(${JSON.stringify(xmlTreeOutput)});
  process.exit(0);
}
process.exit(1);
`
  const apksignerScript = `#!/usr/bin/env node
process.stdout.write(${JSON.stringify(apksignerOutput)});
process.exit(0);
`
  writeFileSync(fakeAapt2, aapt2Script)
  writeFileSync(fakeApksigner, apksignerScript)
  chmodSync(fakeAapt2, 0o755)
  chmodSync(fakeApksigner, 0o755)

  return {
    apkPath: fakeApk,
    fakeKeystore,
    customTools: { aapt2: fakeAapt2, apksigner: fakeApksigner }
  }
}

describe('inspectAndroidApk strict validation', () => {
  const validBadging = `package: name='com.stably.orca.mobile' versionCode='14' versionName='0.0.45' compileSdkVersion='35'
uses-permission: name='android.permission.FOREGROUND_SERVICE'
uses-permission: name='android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK'
application-label:'Orca'`

  const validXmlTree = `N: android=http://schemas.android.com/apk/res/android
  E: manifest (line=2)
    E: uses-permission (line=3)
      A: android:name(0x01010003)="android.permission.FOREGROUND_SERVICE"
    E: uses-permission (line=4)
      A: android:name(0x01010003)="android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK"
    E: application (line=5)
      E: service (line=6)
        A: android:name(0x01010003)="expo.modules.petspeech.PetSpeechForegroundService"
        A: android:foregroundServiceType(0x01010582)=0x00000002`

  const validApksigner = `Verifies
Verified using v1 scheme (JAR signing): true
Verified using v2 scheme (APK Signature Scheme v2): true
Number of signers: 1
Signer #1 certificate DN: CN=Android Debug, O=Android, C=US
Signer #1 certificate SHA-256 digest: aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899
`

  it('fails closed when tools are missing and cannot be resolved', () => {
    expect(() => resolveAndroidSdkTools('/nonexistent-tools-dir')).toThrow(
      'Failed to resolve required Android build tools'
    )
  })

  it('passes inspection and verifies keystore digest with keytool runner', () => {
    const { apkPath, fakeKeystore, customTools } = setupFakeTools({
      badgingOutput: validBadging,
      xmlTreeOutput: validXmlTree,
      apksignerOutput: validApksigner
    })

    const keytoolRunner = () =>
      `Alias name: androiddebugkey
Certificate fingerprints:
     SHA256: AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99`

    const result = inspectAndroidApk({
      apkPath,
      expectedPackage: 'com.stably.orca.mobile',
      expectedVersion: '0.0.45',
      expectedVersionCode: 14,
      debugKeystorePath: fakeKeystore,
      customTools,
      keytoolRunner
    })

    expect(result.package).toBe('com.stably.orca.mobile')
    expect(result.version).toBe('0.0.45')
    expect(result.versionCode).toBe(14)
    expect(result.signerDigestSha256).toBe(
      'aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899'
    )
    expect(result.foregroundServiceType).toBe('mediaPlayback')

    rmSync(fixtureDir, { recursive: true, force: true })
  })

  it('fails closed when keystore sha256 digest mismatches APK signer', () => {
    const { apkPath, fakeKeystore, customTools } = setupFakeTools({
      badgingOutput: validBadging,
      xmlTreeOutput: validXmlTree,
      apksignerOutput: validApksigner
    })

    const keytoolRunner = () =>
      `Alias name: androiddebugkey
Certificate fingerprints:
     SHA256: 00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF`

    expect(() =>
      inspectAndroidApk({
        apkPath,
        expectedPackage: 'com.stably.orca.mobile',
        expectedVersion: '0.0.45',
        expectedVersionCode: 14,
        debugKeystorePath: fakeKeystore,
        customTools,
        keytoolRunner
      })
    ).toThrow('does not match debug.keystore')

    rmSync(fixtureDir, { recursive: true, force: true })
  })

  it('fails closed when FOREGROUND_SERVICE_MEDIA_PLAYBACK permission is missing', () => {
    const invalidXmlTree = `N: android=http://schemas.android.com/apk/res/android
  E: manifest (line=2)
    E: uses-permission (line=3)
      A: android:name(0x01010003)="android.permission.FOREGROUND_SERVICE"
    E: application (line=5)
      E: service (line=6)
        A: android:name(0x01010003)="expo.modules.petspeech.PetSpeechForegroundService"
        A: android:foregroundServiceType(0x01010582)=0x00000002`

    const { apkPath, customTools } = setupFakeTools({
      badgingOutput: `package: name='com.stably.orca.mobile' versionCode='14' versionName='0.0.45'`,
      xmlTreeOutput: invalidXmlTree,
      apksignerOutput: validApksigner
    })

    expect(() =>
      inspectAndroidApk({
        apkPath,
        expectedPackage: 'com.stably.orca.mobile',
        expectedVersion: '0.0.45',
        expectedVersionCode: 14,
        customTools
      })
    ).toThrow('Missing required permission: android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK')

    rmSync(fixtureDir, { recursive: true, force: true })
  })

  it('fails closed when service is present but lacks foregroundServiceType in its own stanza', () => {
    const invalidXmlTree = `N: android=http://schemas.android.com/apk/res/android
  E: manifest (line=2)
    E: uses-permission (line=3)
      A: android:name(0x01010003)="android.permission.FOREGROUND_SERVICE"
    E: uses-permission (line=4)
      A: android:name(0x01010003)="android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK"
    E: application (line=5)
      E: service (line=6)
        A: android:name(0x01010003)="expo.modules.petspeech.PetSpeechForegroundService"
      E: service (line=7)
        A: android:name(0x01010003)="some.other.Service"
        A: android:foregroundServiceType(0x01010582)=0x00000002`

    const { apkPath, customTools } = setupFakeTools({
      badgingOutput: validBadging,
      xmlTreeOutput: invalidXmlTree,
      apksignerOutput: validApksigner
    })

    expect(() =>
      inspectAndroidApk({
        apkPath,
        expectedPackage: 'com.stably.orca.mobile',
        expectedVersion: '0.0.45',
        expectedVersionCode: 14,
        customTools
      })
    ).toThrow(
      'PetSpeechForegroundService stanza missing required android:foregroundServiceType="mediaPlayback"'
    )

    rmSync(fixtureDir, { recursive: true, force: true })
  })

  it('fails closed when package name mismatches', () => {
    const { apkPath, customTools } = setupFakeTools({
      badgingOutput: validBadging,
      xmlTreeOutput: validXmlTree,
      apksignerOutput: validApksigner
    })

    expect(() =>
      inspectAndroidApk({
        apkPath,
        expectedPackage: 'com.wrong.package',
        expectedVersion: '0.0.45',
        expectedVersionCode: 14,
        customTools
      })
    ).toThrow(
      "Package name mismatch: expected 'com.wrong.package', observed 'com.stably.orca.mobile'"
    )

    rmSync(fixtureDir, { recursive: true, force: true })
  })

  it('fails closed when marketing version or versionCode mismatches', () => {
    const { apkPath, customTools } = setupFakeTools({
      badgingOutput: validBadging,
      xmlTreeOutput: validXmlTree,
      apksignerOutput: validApksigner
    })

    expect(() =>
      inspectAndroidApk({
        apkPath,
        expectedPackage: 'com.stably.orca.mobile',
        expectedVersion: '0.0.46',
        expectedVersionCode: 14,
        customTools
      })
    ).toThrow("Version name mismatch: expected '0.0.46', observed '0.0.45'")

    expect(() =>
      inspectAndroidApk({
        apkPath,
        expectedPackage: 'com.stably.orca.mobile',
        expectedVersion: '0.0.45',
        expectedVersionCode: 15,
        customTools
      })
    ).toThrow('VersionCode mismatch: expected 15, observed 14')

    rmSync(fixtureDir, { recursive: true, force: true })
  })

  it('fails closed when certificate is not debug signed', () => {
    const nonDebugApksigner = `Verifies
Signer #1 certificate DN: CN=Production Release, O=Stably, C=US
Signer #1 certificate SHA-256 digest: 112233445566778899aabbccddeeff00112233445566778899aabbccddeeff00
`
    const { apkPath, customTools } = setupFakeTools({
      badgingOutput: validBadging,
      xmlTreeOutput: validXmlTree,
      apksignerOutput: nonDebugApksigner
    })

    expect(() =>
      inspectAndroidApk({
        apkPath,
        expectedPackage: 'com.stably.orca.mobile',
        expectedVersion: '0.0.45',
        expectedVersionCode: 14,
        customTools
      })
    ).toThrow('APK is not signed with debug/development key')

    rmSync(fixtureDir, { recursive: true, force: true })
  })
})
