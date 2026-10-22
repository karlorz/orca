import { describe, expect, it } from 'vitest'
import {
  assertHomeDaemonProtocol,
  compareHomeReleaseTags,
  homeProtocolMetadata,
  homeReleaseAssetUrl,
  homeReleaseFromDesktopTag,
  parseHomeDesktopTagsFromAtom,
  selectHomeAppImageRelease,
  briefHomeUpdateCause,
  classifyHomeUpdateGateMessage,
  HomeUpdateGateError
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
  it('parses prerelease fork desktop tags from the GitHub atom feed', () => {
    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?><feed>',
      '<entry><link rel="alternate" type="text/html" href="https://github.com/karlorz/orca/releases/tag/v1.4.227-6"/></entry>',
      '<entry><link rel="alternate" type="text/html" href="https://github.com/karlorz/orca/releases/tag/v1.4.224-6"/></entry>',
      '<entry><link rel="alternate" type="text/html" href="https://github.com/karlorz/orca/releases/tag/v1.4.227"/></entry>',
      '<entry><link rel="alternate" type="text/html" href="https://github.com/karlorz/orca/releases/tag/mobile-android-v0.0.55-8"/></entry>',
      '</feed>'
    ].join('')
    expect(parseHomeDesktopTagsFromAtom(xml)).toEqual(['v1.4.227-6', 'v1.4.224-6'])
    const release = homeReleaseFromDesktopTag('v1.4.227-6')
    expect(release.prerelease).toBe(true)
    expect(homeReleaseAssetUrl(release, 'orca-linux.AppImage')).toContain('/v1.4.227-6/')
    expect(() => parseHomeDesktopTagsFromAtom('<html>captive portal</html>')).toThrow(
      'Invalid fork release atom feed'
    )
    expect(
      parseHomeDesktopTagsFromAtom(
        '<?xml version="1.0"?><feed><entry><link href="https://github.com/karlorz/orca/releases/tag/v1.4.227-6%2F../evil"/></entry></feed>'
      )
    ).toEqual([])
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
  const metadata44 = { schemaVersion: 1 as const, tag: 'v1.4.224-1', daemonProtocol: 44 }
  function gateError(run: () => void): HomeUpdateGateError {
    try {
      run()
    } catch (error) {
      expect(error).toBeInstanceOf(HomeUpdateGateError)
      return error as HomeUpdateGateError
    }
    throw new Error('expected the gate to block')
  }

  it.each([
    [null, 'unavailable'],
    [[], 'none-live'],
    [
      { protocols: null, reason: 'none-live' as const, detail: 'refused: protocol 44, 45' },
      'none-live'
    ],
    [{ protocols: null, reason: 'timeout' as const }, 'timeout'],
    [{ protocols: [] }, 'none-live']
  ])('blocks unknown live daemon state as retryable, never an empty pass: %j', (live, reason) => {
    const error = gateError(() => assertHomeDaemonProtocol(metadata44, 'v1.4.224-1', live))
    expect(error.kind).toBe('daemon-state-unknown')
    expect(error.retryable).toBe(true)
    expect(error.reason).toBe(reason)
    expect(error.message).toMatch(/^Could not verify the live terminal daemons \(/)
    expect(error.message).toContain(reason)
    expect(classifyHomeUpdateGateMessage(error.message)).toBe('daemon-state-unknown')
  })

  it.each([
    [[43], 'v1.4.224-1 needs daemon protocol 44; live daemons: 43'],
    [[44, 43], 'v1.4.224-1 needs daemon protocol 44; live daemons: 43, 44'],
    [{ protocols: [50], skipped: [45] }, 'needs daemon protocol 44; live daemons: 50']
  ])('blocks a genuine mismatch as attended with both protocols: %j', (live, detail) => {
    const error = gateError(() => assertHomeDaemonProtocol(metadata44, 'v1.4.224-1', live))
    expect(error.kind).toBe('protocol-mismatch')
    expect(error.retryable).toBe(false)
    expect(error.message).toContain(detail)
    expect(error.message).toContain('attended daemon protocol update')
    expect(error.message).toContain('#attended-daemon-protocol-update')
    expect(classifyHomeUpdateGateMessage(error.message)).toBe('protocol-mismatch')
  })

  it('accepts matching live daemon protocols and rejects tag mismatch', () => {
    const metadata = homeProtocolMetadata.parse({
      schemaVersion: 1,
      tag: 'v1.4.224-1',
      daemonProtocol: 44
    })
    expect(() => assertHomeDaemonProtocol(metadata, metadata.tag, [44])).not.toThrow()
    expect(() =>
      assertHomeDaemonProtocol(metadata, metadata.tag, { protocols: [44], skipped: [43] })
    ).not.toThrow()
    const error = gateError(() => assertHomeDaemonProtocol(metadata, 'v1.4.224-2', [44]))
    expect(error.kind).toBe('protocol-mismatch')
    expect(error.message).toContain('protocol metadata names v1.4.224-1, not v1.4.224-2')
  })

  it('classifies only the three gate prefixes and keeps causes free of URLs', () => {
    expect(
      classifyHomeUpdateGateMessage('Could not read the daemon protocol metadata for v1')
    ).toBe('metadata-unavailable')
    expect(classifyHomeUpdateGateMessage('AppImage download returned an empty body')).toBeNull()
    expect(
      briefHomeUpdateCause(
        new Error('fetch failed https://objects.githubusercontent.com/a?X-Amz-Signature=abc')
      )
    ).toBe('fetch failed <url>')
    expect(briefHomeUpdateCause(new Error('x'.repeat(400)))).toHaveLength(160)
  })
})
