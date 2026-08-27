import { describe, expect, it } from 'vitest'
import { buildTagMirrorPlan, parseTagRefMap } from './fork-sync-upstream-tags.mjs'

describe('fork sync upstream tags planner', () => {
  it('parses raw ls-remote lines into ref -> sha map', () => {
    const lines = [
      '6e4f817101684c1737e411b0e7195c8088cb1519\trefs/tags/v1.4.190',
      'b7fa34552093556093845c85d774a382c40cba8a\trefs/tags/v1.4.190^{}'
    ]
    const map = parseTagRefMap(lines)
    expect(map.get('refs/tags/v1.4.190')).toBe('6e4f817101684c1737e411b0e7195c8088cb1519')
    expect(map.get('refs/tags/v1.4.190^{}')).toBe('b7fa34552093556093845c85d774a382c40cba8a')
  })

  it('builds mirror plan for missing v* tags only, ignoring non-v* tags', () => {
    const upstream = [
      '1111111111111111111111111111111111111111\trefs/tags/v1.4.188',
      '2222222222222222222222222222222222222222\trefs/tags/v1.4.189-rc.0',
      '3333333333333333333333333333333333333333\trefs/tags/v1.4.190',
      '4444444444444444444444444444444444444444\trefs/tags/mobile-android-v0.0.44',
      '5555555555555555555555555555555555555555\trefs/tags/nightly-2026-08-27'
    ]
    const fork = ['1111111111111111111111111111111111111111\trefs/tags/v1.4.188']

    const plan = buildTagMirrorPlan(upstream, fork)
    expect(plan.toMirror).toEqual([
      {
        name: 'v1.4.189-rc.0',
        ref: 'refs/tags/v1.4.189-rc.0',
        sha: '2222222222222222222222222222222222222222'
      },
      {
        name: 'v1.4.190',
        ref: 'refs/tags/v1.4.190',
        sha: '3333333333333333333333333333333333333333'
      }
    ])
    expect(plan.diverged).toEqual([])
    expect(plan.identical).toEqual([
      {
        name: 'v1.4.188',
        ref: 'refs/tags/v1.4.188',
        sha: '1111111111111111111111111111111111111111'
      }
    ])
  })

  it('flags diverged tags with different shas and does not plan to mirror or overwrite', () => {
    const upstream = ['1111111111111111111111111111111111111111\trefs/tags/v1.4.188']
    const fork = ['9999999999999999999999999999999999999999\trefs/tags/v1.4.188']

    const plan = buildTagMirrorPlan(upstream, fork)
    expect(plan.toMirror).toEqual([])
    expect(plan.diverged).toEqual([
      {
        name: 'v1.4.188',
        ref: 'refs/tags/v1.4.188',
        upstreamSha: '1111111111111111111111111111111111111111',
        forkSha: '9999999999999999999999999999999999999999'
      }
    ])
  })
})
