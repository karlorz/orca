import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parse } from 'yaml'
import {
  buildAutoCutPlan,
  buildNextMobileTagPlan,
  parseUpstreamMobileBase,
  planMobileAppJsonForTrain
} from './fork-next-mobile-tag.mjs'

const projectDir = resolve(import.meta.dirname, '../..')
const workflowPath = join(projectDir, '.github/workflows/fork-sync-main.yml')

describe('fork next mobile tag planner', () => {
  it('parses exact upstream mobile-android tags', () => {
    expect(parseUpstreamMobileBase('mobile-android-v0.0.46')).toBe('0.0.46')
    expect(parseUpstreamMobileBase('mobile-android-v0.0.44')).toBe('0.0.44')
  })

  it('rejects fork suffixes, karlorz suffixes, and desktop tags', () => {
    expect(() => parseUpstreamMobileBase('mobile-android-v0.0.44-15')).toThrow(
      /not a valid upstream mobile release tag/
    )
    expect(() => parseUpstreamMobileBase('mobile-android-v0.0.45-karlorz.0')).toThrow(
      /not a valid upstream mobile release tag/
    )
    expect(() => parseUpstreamMobileBase('v1.4.190')).toThrow(
      /not a valid upstream mobile release tag/
    )
  })

  it('detects next fork tag on a new upstream base while old 0.0.44-N tags exist', () => {
    const plan = buildNextMobileTagPlan({
      upstreamTag: 'mobile-android-v0.0.46',
      forkTags: [
        'mobile-android-v0.0.44-14',
        'mobile-android-v0.0.44-15',
        'mobile-android-v0.0.45-karlorz.1'
      ]
    })
    expect(plan.base).toBe('0.0.46')
    expect(plan.suffix).toBe(0)
    expect(plan.nextTag).toBe('mobile-android-v0.0.46-0')
    expect(plan.tagRef).toBe('refs/tags/mobile-android-v0.0.46-0')
  })

  it('increments suffix on the same mobile base', () => {
    const plan = buildNextMobileTagPlan({
      upstreamTag: 'mobile-android-v0.0.46',
      forkTags: ['mobile-android-v0.0.46-0']
    })
    expect(plan.nextTag).toBe('mobile-android-v0.0.46-1')
  })

  it('auto-cut plans a -0 when fork has not covered the new mobile base', () => {
    const plan = buildAutoCutPlan({
      upstreamTag: 'mobile-android-v0.0.46',
      forkTags: ['mobile-android-v0.0.44-15']
    })
    expect(plan.cut).toBe(true)
    expect(plan.nextTag).toBe('mobile-android-v0.0.46-0')
  })

  it('auto-cut skips when fork already has that mobile base', () => {
    const plan = buildAutoCutPlan({
      upstreamTag: 'mobile-android-v0.0.46',
      forkTags: ['mobile-android-v0.0.46-0']
    })
    expect(plan.cut).toBe(false)
    expect(plan.reason).toMatch(/already covered/)
  })

  it('bumps marketing version to the published train and increments versionCode', () => {
    expect(
      planMobileAppJsonForTrain({
        expoVersion: '0.0.44',
        versionCode: 29,
        trainBase: '0.0.46',
        bumpVersionCode: true
      })
    ).toEqual({ expoVersion: '0.0.46', versionCode: 30 })
  })
})

describe('fork-sync auto-cuts mobile -0 on a new published train', () => {
  it('runs the mobile planner with --auto after desktop auto-cut', () => {
    expect(existsSync(workflowPath)).toBe(true)
    const workflow = parse(readFileSync(workflowPath, 'utf8'))
    const scripts = workflow.jobs['sync-fork-main'].steps.map((step) => step.run ?? '').join('\n')
    expect(scripts).toContain('fork-next-mobile-tag.mjs --auto')
    expect(scripts).not.toMatch(/fork-next-mobile-tag\.mjs[^\n]*--write/)
    const autoCutStep = workflow.jobs['sync-fork-main'].steps.find((step) =>
      String(step.run ?? '').includes('fork-next-mobile-tag.mjs')
    )
    expect(autoCutStep.run).toContain('--auto')
    expect(autoCutStep.run).not.toContain('--write')
  })
})
