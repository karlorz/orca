import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  extractManifestRelativeAssetNames,
  REQUIRED_FORK_DESKTOP_ARCHIVES,
  UPDATE_MANIFEST_FILENAME,
  verifyForkDesktopReleaseArtifacts
} from './verify-fork-desktop-release-artifacts.mjs'

describe('extractManifestRelativeAssetNames', () => {
  it('extracts unique referenced assets from path and files arrays', () => {
    const yaml = `
version: 1.4.193-0
files:
  - url: orca-macos-x64.zip
    sha512: dGVzdDE=
    size: 100
  - url: orca-macos-arm64.zip
    sha512: dGVzdDI=
    size: 200
path: orca-macos-x64.zip
sha512: dGVzdDE=
releaseDate: '2026-08-31T12:00:00.000Z'
`
    const extracted = extractManifestRelativeAssetNames(yaml)
    expect(extracted).toEqual(['orca-macos-arm64.zip', 'orca-macos-x64.zip'])
  })

  it('extracts filenames from absolute URLs and files path properties', () => {
    const yaml = `
version: 1.4.193-0
files:
  - url: https://github.com/karlorz/orca/releases/download/v1.4.193-0/orca-macos-arm64.zip
  - path: orca-macos-x64.zip
`
    const extracted = extractManifestRelativeAssetNames(yaml)
    expect(extracted).toEqual(['orca-macos-arm64.zip', 'orca-macos-x64.zip'])
  })

  it('rejects malformed YAML, non-object YAML roots, and missing asset references', () => {
    expect(() => extractManifestRelativeAssetNames('foo: [unclosed')).toThrow(
      /Failed to parse update manifest YAML/
    )
    expect(() => extractManifestRelativeAssetNames('["array", "root"]')).toThrow(
      /root must be an object/
    )
    expect(() => extractManifestRelativeAssetNames('just a string')).toThrow(
      /root must be an object/
    )
    expect(() => extractManifestRelativeAssetNames('version: 1.4.193-0\nother: field\n')).toThrow(
      /references zero asset files/
    )
    expect(() =>
      extractManifestRelativeAssetNames('version: 1.4.193-0\nfiles: "not-an-array"\n')
    ).toThrow(/must be an array/)
    expect(() =>
      extractManifestRelativeAssetNames('version: 1.4.193-0\nfiles:\n  - "not-an-object"\n')
    ).toThrow(/must be an object/)
    expect(() =>
      extractManifestRelativeAssetNames('version: 1.4.193-0\npath: /absolute/path/file.zip\n')
    ).toThrow(/cannot be an absolute path/)
    expect(() =>
      extractManifestRelativeAssetNames('version: 1.4.193-0\npath: subdir/file.zip\n')
    ).toThrow(/cannot contain directory separators/)
  })
})

describe('verifyForkDesktopReleaseArtifacts', () => {
  let testDir

  beforeEach(() => {
    testDir = join(
      tmpdir(),
      `test-fork-desktop-artifacts-${Date.now()}-${Math.random().toString(36).slice(2)}`
    )
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    if (testDir) {
      rmSync(testDir, { recursive: true, force: true })
    }
  })

  const populateValidArtifacts = (extraFiles = []) => {
    for (const archive of REQUIRED_FORK_DESKTOP_ARCHIVES) {
      writeFileSync(join(testDir, archive), `mock ${archive}`)
    }
    const manifestYaml = `
version: 1.4.193-0
files:
  - url: orca-macos-x64.zip
    sha512: dGVzdA==
  - url: orca-macos-arm64.zip
    sha512: dGVzdA==
path: orca-macos-x64.zip
sha512: dGVzdA==
`
    writeFileSync(join(testDir, UPDATE_MANIFEST_FILENAME), manifestYaml)
    for (const file of extraFiles) {
      writeFileSync(join(testDir, file), `mock ${file}`)
    }
  }

  it('passes when all four required archives and manifest-referenced assets exist', () => {
    populateValidArtifacts([
      'orca-macos-x64.dmg.blockmap',
      'orca-macos-arm64.dmg.blockmap',
      'SHA256SUMS.txt'
    ])
    const result = verifyForkDesktopReleaseArtifacts(testDir)
    expect(result.requiredArchives).toEqual(REQUIRED_FORK_DESKTOP_ARCHIVES)
    expect(result.referencedAssets).toEqual(['orca-macos-arm64.zip', 'orca-macos-x64.zip'])
    expect(result.presentFiles).toContain('SHA256SUMS.txt')
  })

  it('fails closed when manifest is missing', () => {
    for (const archive of REQUIRED_FORK_DESKTOP_ARCHIVES) {
      writeFileSync(join(testDir, archive), `mock ${archive}`)
    }
    expect(() => verifyForkDesktopReleaseArtifacts(testDir)).toThrow(
      /Missing required update manifest latest-mac.yml/
    )
  })

  it('fails closed when any of the 4 required archives are missing', () => {
    writeFileSync(
      join(testDir, UPDATE_MANIFEST_FILENAME),
      'version: 1.4.193-0\npath: orca-macos-arm64.dmg\n'
    )
    writeFileSync(join(testDir, 'orca-macos-arm64.dmg'), 'content')
    expect(() => verifyForkDesktopReleaseArtifacts(testDir)).toThrow(
      /missing required release archive\(s\)/
    )
  })

  it('fails closed when a manifest-referenced asset is missing from the directory', () => {
    for (const archive of REQUIRED_FORK_DESKTOP_ARCHIVES) {
      writeFileSync(join(testDir, archive), `mock ${archive}`)
    }
    const manifestYaml = `
version: 1.4.193-0
files:
  - url: orca-macos-x64.zip
  - url: orca-macos-arm64.zip
  - url: orca-macos-arm64-extra.zip
path: orca-macos-x64.zip
`
    writeFileSync(join(testDir, UPDATE_MANIFEST_FILENAME), manifestYaml)
    expect(() => verifyForkDesktopReleaseArtifacts(testDir)).toThrow(
      /references asset\(s\) not present in artifact directory:\n  orca-macos-arm64-extra.zip/
    )
  })

  it('verifies Linux release artifacts when platform is linux', () => {
    writeFileSync(join(testDir, 'orca-linux.AppImage'), 'mock appimage')
    writeFileSync(join(testDir, 'orca-ide_1.4.197-0_amd64.deb'), 'mock deb')
    writeFileSync(join(testDir, 'orca-ide-1.4.197-0.x86_64.rpm'), 'mock rpm')
    const linuxManifest = `
version: 1.4.197-0
files:
  - url: orca-linux.AppImage
    sha512: dGVzdA==
path: orca-linux.AppImage
sha512: dGVzdA==
`
    writeFileSync(join(testDir, 'latest-linux.yml'), linuxManifest)

    const result = verifyForkDesktopReleaseArtifacts(testDir, { platform: 'linux' })
    expect(result.manifest).toBe('latest-linux.yml')
    expect(result.referencedAssets).toEqual(['orca-linux.AppImage'])
    expect(result.presentFiles).toContain('orca-linux.AppImage')
  })

  it('fails Linux verification when latest-linux.yml or required Linux packages are missing', () => {
    expect(() => verifyForkDesktopReleaseArtifacts(testDir, { platform: 'linux' })).toThrow(
      /Missing required update manifest latest-linux.yml/
    )

    writeFileSync(
      join(testDir, 'latest-linux.yml'),
      'version: 1.4.197-0\npath: orca-linux.AppImage\n'
    )
    expect(() => verifyForkDesktopReleaseArtifacts(testDir, { platform: 'linux' })).toThrow(
      /missing required release archive\(s\)/
    )
  })

  it('verifies Windows release artifacts when platform is windows', () => {
    writeFileSync(join(testDir, 'orca-windows-setup.exe'), 'mock exe')
    writeFileSync(join(testDir, 'orca-windows-setup.exe.blockmap'), 'mock blockmap')
    const winManifest = `
version: 1.4.197-0
files:
  - url: orca-windows-setup.exe
    sha512: dGVzdA==
path: orca-windows-setup.exe
sha512: dGVzdA==
`
    writeFileSync(join(testDir, 'latest.yml'), winManifest)

    const result = verifyForkDesktopReleaseArtifacts(testDir, { platform: 'windows' })
    expect(result.manifest).toBe('latest.yml')
    expect(result.referencedAssets).toEqual(['orca-windows-setup.exe'])
    expect(result.presentFiles).toContain('orca-windows-setup.exe')
  })

  it('fails Windows verification when latest.yml, installer, or blockmap is missing', () => {
    expect(() => verifyForkDesktopReleaseArtifacts(testDir, { platform: 'windows' })).toThrow(
      /Missing required update manifest latest.yml/
    )

    writeFileSync(join(testDir, 'latest.yml'), 'version: 1.4.197-0\npath: orca-windows-setup.exe\n')
    expect(() => verifyForkDesktopReleaseArtifacts(testDir, { platform: 'windows' })).toThrow(
      /missing required release archive\(s\)/
    )
  })

  it('verifies all platform artifacts when platform is all', () => {
    populateValidArtifacts()
    writeFileSync(join(testDir, 'orca-linux.AppImage'), 'mock appimage')
    writeFileSync(join(testDir, 'orca-ide_1.4.197-0_amd64.deb'), 'mock deb')
    writeFileSync(join(testDir, 'orca-ide-1.4.197-0.x86_64.rpm'), 'mock rpm')
    writeFileSync(
      join(testDir, 'latest-linux.yml'),
      'version: 1.4.197-0\nfiles:\n  - url: orca-linux.AppImage\npath: orca-linux.AppImage\n'
    )
    writeFileSync(join(testDir, 'orca-windows-setup.exe'), 'mock exe')
    writeFileSync(join(testDir, 'orca-windows-setup.exe.blockmap'), 'mock blockmap')
    writeFileSync(
      join(testDir, 'latest.yml'),
      'version: 1.4.197-0\nfiles:\n  - url: orca-windows-setup.exe\npath: orca-windows-setup.exe\n'
    )

    const result = verifyForkDesktopReleaseArtifacts(testDir, { platform: 'all' })
    expect(result.platforms).toEqual(['mac', 'linux', 'windows'])
  })
})
