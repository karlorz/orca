import { describe, expect, it } from 'vitest'
import {
  parseForkDesktopTag,
  resolveForkDesktopBuildIdentity
} from './fork-desktop-build-version.mjs'

describe('fork desktop build versioning', () => {
  it('parses valid fork desktop tag into base version and suffix', () => {
    expect(parseForkDesktopTag('v1.4.190-0')).toEqual({
      baseVersion: '1.4.190',
      suffix: 0,
      canonicalVersion: '1.4.190-0'
    })
    expect(parseForkDesktopTag('v1.4.190-12')).toEqual({
      baseVersion: '1.4.190',
      suffix: 12,
      canonicalVersion: '1.4.190-12'
    })
    expect(parseForkDesktopTag('refs/tags/v1.4.191-0')).toEqual({
      baseVersion: '1.4.191',
      suffix: 0,
      canonicalVersion: '1.4.191-0'
    })
    expect(parseForkDesktopTag('v1.4.190-4')).toEqual({
      baseVersion: '1.4.190',
      suffix: 4,
      canonicalVersion: '1.4.190-4'
    })
  })

  it('rejects invalid tag shapes', () => {
    expect(() => parseForkDesktopTag('desktop-v1.4.178-0')).toThrow(
      /not a valid fork desktop tag/
    )
    expect(() => parseForkDesktopTag('v1.4.190')).toThrow(/not a valid fork desktop tag/)
    expect(() => parseForkDesktopTag('v1.4.190-rc.0')).toThrow(/not a valid fork desktop tag/)
    expect(() => parseForkDesktopTag('mobile-android-v0.0.44-0')).toThrow(
      /not a valid fork desktop tag/
    )
    expect(() => parseForkDesktopTag('v1.4.190-fork.voice.1.1.abcdef1')).toThrow(
      /not a valid fork desktop tag/
    )
  })

  it('resolves canonical 1.4.190-4 identity directly from tag v1.4.190-4', () => {
    const identity = resolveForkDesktopBuildIdentity({
      FORK_DESKTOP_TAG: 'v1.4.190-4',
      GITHUB_SHA: 'abcdef1234567890abcdef1234567890abcdef12'
    })

    expect(identity.version).toBe('1.4.190-4')
    expect(identity.baseVersion).toBe('1.4.190')
    expect(identity.suffix).toBe(4)
    expect(identity.sha).toBe('abcdef1234567890abcdef1234567890abcdef12')
    expect(identity.shortSha).toBe('abcdef1')
  })

  it('supports argv tag fallback when env is missing', () => {
    const identity = resolveForkDesktopBuildIdentity(
      {
        GITHUB_SHA: '1234567890abcdef1234567890abcdef12345678'
      },
      ['node', 'fork-desktop-build-version.mjs', 'v1.4.191-2']
    )

    expect(identity.version).toBe('1.4.191-2')
    expect(identity.baseVersion).toBe('1.4.191')
    expect(identity.suffix).toBe(2)
  })
})
