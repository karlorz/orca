import { describe, expect, it } from 'vitest'
import {
  parseForkDesktopTagBase,
  resolveForkDesktopBuildIdentity
} from './fork-desktop-build-version.mjs'

describe('fork desktop build versioning', () => {
  it('parses valid fork desktop tag into base version', () => {
    expect(parseForkDesktopTagBase('v1.4.190-0')).toBe('1.4.190')
    expect(parseForkDesktopTagBase('v1.4.190-12')).toBe('1.4.190')
    expect(parseForkDesktopTagBase('refs/tags/v1.4.191-0')).toBe('1.4.191')
  })

  it('rejects invalid tag shapes', () => {
    expect(() => parseForkDesktopTagBase('desktop-v1.4.178-0')).toThrow(
      /not a valid fork desktop tag/
    )
    expect(() => parseForkDesktopTagBase('v1.4.190')).toThrow(/not a valid fork desktop tag/)
    expect(() => parseForkDesktopTagBase('v1.4.190-rc.0')).toThrow(/not a valid fork desktop tag/)
    expect(() => parseForkDesktopTagBase('mobile-android-v0.0.44-0')).toThrow(
      /not a valid fork desktop tag/
    )
  })

  it('resolves deterministic fork voice build version from tag and github env', () => {
    const identity = resolveForkDesktopBuildIdentity({
      FORK_DESKTOP_TAG: 'v1.4.190-0',
      GITHUB_RUN_NUMBER: '42',
      GITHUB_RUN_ATTEMPT: '1',
      GITHUB_SHA: 'abcdef1234567890abcdef1234567890abcdef12'
    })

    expect(identity.version).toBe('1.4.190-fork.voice.42.1.abcdef1')
    expect(identity.baseVersion).toBe('1.4.190')
    expect(identity.runNumber).toBe('42')
    expect(identity.runAttempt).toBe('1')
    expect(identity.shortSha).toBe('abcdef1')
  })

  it('supports argv tag fallback when env is missing', () => {
    const identity = resolveForkDesktopBuildIdentity(
      {
        GITHUB_RUN_NUMBER: '5',
        GITHUB_RUN_ATTEMPT: '2',
        GITHUB_SHA: '1234567890abcdef1234567890abcdef12345678'
      },
      ['node', 'fork-desktop-build-version.mjs', 'v1.4.191-2']
    )

    expect(identity.version).toBe('1.4.191-fork.voice.5.2.1234567')
    expect(identity.baseVersion).toBe('1.4.191')
  })
})
