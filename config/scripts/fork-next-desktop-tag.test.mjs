import { describe, expect, it } from 'vitest'
import {
  buildAutoCutPlan,
  buildNextDesktopTagPlan,
  compareSemverBases,
  nextForkSuffix,
  parseUpstreamDesktopBase
} from './fork-next-desktop-tag.mjs'

describe('fork next desktop tag planner', () => {
  it('parses stable and rc upstream desktop tags to clean semver base', () => {
    expect(parseUpstreamDesktopBase('v1.4.190')).toBe('1.4.190')
    expect(parseUpstreamDesktopBase('v1.4.191-rc.0')).toBe('1.4.191')
    expect(parseUpstreamDesktopBase('v1.4.191-rc.12')).toBe('1.4.191')
  })

  it('rejects invalid upstream tag shapes', () => {
    expect(() => parseUpstreamDesktopBase('1.4.190')).toThrow(
      /not a valid upstream desktop release tag/
    )
    expect(() => parseUpstreamDesktopBase('mobile-android-v0.0.44')).toThrow(
      /not a valid upstream desktop release tag/
    )
    expect(() => parseUpstreamDesktopBase('desktop-v1.4.178-0')).toThrow(
      /not a valid upstream desktop release tag/
    )
    expect(() => parseUpstreamDesktopBase('v1.4.190-0')).toThrow(
      /not a valid upstream desktop release tag/
    )
  })

  it('computes next fork suffix correctly (0-based)', () => {
    expect(nextForkSuffix([], '1.4.190')).toBe(0)
    expect(nextForkSuffix(['desktop-v1.4.178-0', 'v1.4.188'], '1.4.190')).toBe(0)
    expect(nextForkSuffix(['v1.4.190-0'], '1.4.190')).toBe(1)
    expect(nextForkSuffix(['v1.4.190-0', 'v1.4.190-1', 'v1.4.190-5'], '1.4.190')).toBe(6)
    expect(nextForkSuffix(['refs/tags/v1.4.190-0', 'refs/tags/v1.4.190-1'], '1.4.190')).toBe(2)
  })

  it('builds plan for next tag with clean base and suffix', () => {
    const plan = buildNextDesktopTagPlan({
      upstreamTag: 'v1.4.191-rc.0',
      forkTags: ['v1.4.190-0', 'v1.4.190-1']
    })
    expect(plan.base).toBe('1.4.191')
    expect(plan.suffix).toBe(0)
    expect(plan.nextTag).toBe('v1.4.191-0')
    expect(plan.tagRef).toBe('refs/tags/v1.4.191-0')
  })

  it('increments suffix when base matches existing fork tags', () => {
    const plan = buildNextDesktopTagPlan({
      upstreamTag: 'v1.4.190',
      forkTags: ['v1.4.190-0', 'v1.4.190-1']
    })
    expect(plan.base).toBe('1.4.190')
    expect(plan.suffix).toBe(2)
    expect(plan.nextTag).toBe('v1.4.190-2')
  })

  it('enforces monotonic guard: refuses base lower than already used fork base', () => {
    expect(() =>
      buildNextDesktopTagPlan({
        upstreamTag: 'v1.4.189-rc.0',
        forkTags: ['v1.4.190-0']
      })
    ).toThrow(/Refusing base 1.4.189 lower than existing fork base 1.4.190/)
  })

  it('compares semver bases accurately', () => {
    expect(compareSemverBases('1.4.190', '1.4.189')).toBeGreaterThan(0)
    expect(compareSemverBases('1.4.190', '1.4.190')).toBe(0)
    expect(compareSemverBases('1.4.189', '1.4.190')).toBeLessThan(0)
    expect(compareSemverBases('2.0.0', '1.99.99')).toBeGreaterThan(0)
  })
})

describe('fork desktop auto-cut planner', () => {
  it('cuts v<base>-0 when no fork desktop tag exists yet', () => {
    const plan = buildAutoCutPlan({ upstreamTag: 'v1.4.190', forkTags: [] })
    expect(plan.cut).toBe(true)
    expect(plan.nextTag).toBe('v1.4.190-0')
    expect(plan.tagRef).toBe('refs/tags/v1.4.190-0')
  })

  it('skips when the base already has a fork tag (daily no-op)', () => {
    const plan = buildAutoCutPlan({
      upstreamTag: 'v1.4.190',
      forkTags: ['v1.4.190-0']
    })
    expect(plan.cut).toBe(false)
    expect(plan.reason).toContain('1.4.190')
  })

  it('skips when upstream newest is lower than an existing fork base', () => {
    const plan = buildAutoCutPlan({
      upstreamTag: 'v1.4.189-rc.0',
      forkTags: ['v1.4.190-0']
    })
    expect(plan.cut).toBe(false)
  })

  it('cuts -0 for a newer base even when older fork tags exist', () => {
    const plan = buildAutoCutPlan({
      upstreamTag: 'v1.4.191-rc.0',
      forkTags: ['v1.4.190-0', 'v1.4.190-3']
    })
    expect(plan.cut).toBe(true)
    expect(plan.base).toBe('1.4.191')
    expect(plan.nextTag).toBe('v1.4.191-0')
  })

  it('ignores upstream-style and legacy tags when judging fork bases', () => {
    const plan = buildAutoCutPlan({
      upstreamTag: 'v1.4.190',
      forkTags: ['v1.4.188', 'v1.4.189-rc.0', 'desktop-v1.4.178-0']
    })
    expect(plan.cut).toBe(true)
    expect(plan.nextTag).toBe('v1.4.190-0')
  })
})
