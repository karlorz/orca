import { describe, expect, it } from 'vitest'
import {
  assertHomeDaemonProtocol,
  compareHomeReleaseTags,
  homeProtocolMetadata,
  homeReleaseAssetUrl,
  selectHomeAppImageRelease,
  HOME_UPDATE_PROTOCOL_MESSAGE
} from './home-appimage-release-policy'

export function homeReleaseFixture(tag = 'v1.4.224-1') {
  return {
    tag_name: tag,
    draft: false,
    prerelease: true,
    assets: ['orca-linux.AppImage', 'SHA256SUMS.txt', 'orca-update-protocol.json'].map((name) => ({
      name,
      browser_download_url: `https://github.com/karlorz/orca/releases/download/${tag}/${name}`
    }))
  }
}

describe('managed home release policy', () => {
  it('includes prereleases and orders numeric fork suffixes', () => {
    expect(
      selectHomeAppImageRelease(
        [
          homeReleaseFixture('v1.4.224-9'),
          homeReleaseFixture('v1.4.224-10'),
          { ...homeReleaseFixture('v1.4.999-1'), draft: true },
          homeReleaseFixture('v1.4.224'),
          homeReleaseFixture('mobile-android-v9.0.0-0')
        ],
        'v1.4.224-0'
      )?.tag_name
    ).toBe('v1.4.224-10')
    expect(compareHomeReleaseTags('v1.4.225-0', 'v1.4.224-999')).toBeGreaterThan(0)
    expect(selectHomeAppImageRelease([homeReleaseFixture()], 'v1.4.224-1')).toBeNull()
  })
  it('skips releases missing required download assets', () => {
    const incomplete = homeReleaseFixture('v1.4.225-0')
    incomplete.assets = incomplete.assets.filter((asset) => asset.name !== 'SHA256SUMS.txt')
    expect(
      selectHomeAppImageRelease([incomplete, homeReleaseFixture()], 'v1.4.224-0')?.tag_name
    ).toBe('v1.4.224-1')
    incomplete.assets = []
    expect(selectHomeAppImageRelease([incomplete], 'v1.4.224-0')).toBeNull()
  })
  it('keeps assets tied to the selected fork tag', () => {
    const release = homeReleaseFixture()
    expect(homeReleaseAssetUrl(release, 'orca-linux.AppImage')).toContain('/v1.4.224-1/')
    release.assets[0].browser_download_url = 'https://example.com/orca-linux.AppImage'
    expect(() => homeReleaseAssetUrl(release, 'orca-linux.AppImage')).toThrow('immutable tag')
    expect(() => homeReleaseAssetUrl(homeReleaseFixture(), 'missing')).toThrow('exactly one')
  })
  it.each([null, [], [43], [44, 43]])(
    'gates unverifiable and mismatched live daemons: %s',
    (protocols) => {
      expect(() =>
        assertHomeDaemonProtocol(
          { schemaVersion: 1, tag: 'v1.4.224-1', daemonProtocol: 44 },
          'v1.4.224-1',
          protocols
        )
      ).toThrow(HOME_UPDATE_PROTOCOL_MESSAGE)
    }
  )
  it('accepts matching live daemon protocols and rejects tag mismatch', () => {
    const metadata = homeProtocolMetadata.parse({
      schemaVersion: 1,
      tag: 'v1.4.224-1',
      daemonProtocol: 44
    })
    expect(() => assertHomeDaemonProtocol(metadata, metadata.tag, [44])).not.toThrow()
    expect(() => assertHomeDaemonProtocol(metadata, 'v1.4.224-2', [44])).toThrow(
      HOME_UPDATE_PROTOCOL_MESSAGE
    )
  })
})
