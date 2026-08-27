import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parse } from 'yaml'
import { classifyReleaseTrain, selectLatestTrains } from './fork-upstream-trains.mjs'

const projectDir = resolve(import.meta.dirname, '../..')
const workflowPath = join(projectDir, '.github/workflows/fork-sync-main.yml')

function release(tag, { prerelease = false, draft = false, publishedAt }) {
  return {
    tag_name: tag,
    prerelease,
    draft,
    published_at: publishedAt,
    html_url: `https://github.com/stablyai/orca/releases/tag/${tag}`
  }
}

describe('classifyReleaseTrain', () => {
  it('splits desktop v* from mobile-android-v* and ignores fork mobile suffixes', () => {
    expect(classifyReleaseTrain('v1.4.188')).toBe('desktop')
    expect(classifyReleaseTrain('v1.4.184-rc.0')).toBe('desktop')
    expect(classifyReleaseTrain('mobile-android-v0.0.44')).toBe('mobile')
    expect(classifyReleaseTrain('mobile-android-v0.0.44-2')).toBe('ignore')
    expect(classifyReleaseTrain('fork-voice-v0.0.45.4')).toBe('ignore')
  })
})

describe('selectLatestTrains', () => {
  it('picks newest published desktop and mobile including prereleases, skipping drafts', () => {
    const trains = selectLatestTrains([
      release('v1.4.187', { publishedAt: '2026-08-21T07:44:44Z' }),
      release('v1.4.188', { publishedAt: '2026-08-22T06:12:27Z' }),
      release('v1.4.189-rc.0', {
        prerelease: true,
        publishedAt: '2026-08-23T01:00:00Z'
      }),
      release('mobile-android-v0.0.43', {
        prerelease: true,
        publishedAt: '2026-08-15T02:35:26Z'
      }),
      release('mobile-android-v0.0.44', {
        prerelease: true,
        publishedAt: '2026-08-22T07:41:12Z'
      }),
      release('mobile-android-v0.0.45', {
        prerelease: true,
        draft: true,
        publishedAt: '2026-08-24T00:00:00Z'
      }),
      release('mobile-android-v0.0.44-2', { publishedAt: '2026-08-26T00:00:00Z' })
    ])

    expect(trains.desktop.tag).toBe('v1.4.189-rc.0')
    expect(trains.desktop.prerelease).toBe(true)
    expect(trains.mobile.tag).toBe('mobile-android-v0.0.44')
    expect(trains.mobile.prerelease).toBe(true)
  })

  it('keeps the two trains independent when one is newer', () => {
    const trains = selectLatestTrains([
      release('v1.4.188', { publishedAt: '2026-08-22T06:12:27Z' }),
      release('mobile-android-v0.0.44', {
        prerelease: true,
        publishedAt: '2026-08-22T07:41:12Z'
      })
    ])
    expect(trains.desktop.tag).toBe('v1.4.188')
    expect(trains.desktop.prerelease).toBe(false)
    expect(trains.mobile.tag).toBe('mobile-android-v0.0.44')
    expect(trains.desktop.tag).not.toBe(trains.mobile.tag)
  })
})

describe('fork-sync-main workflow trains', () => {
  it('reports desktop and mobile trains from the main mirror job without merge-upstream on fork-main', () => {
    expect(existsSync(workflowPath)).toBe(true)
    const workflow = parse(readFileSync(workflowPath, 'utf8'))
    const job = workflow.jobs['sync-main']
    const scripts = job.steps.map((step) => step.run ?? '').join('\n')
    expect(scripts).toContain('fork-upstream-trains.mjs')
    expect(scripts).toContain('MIRROR_BRANCH=main')
    expect(scripts).not.toMatch(/MIRROR_BRANCH=fork-main/)
    expect(scripts).not.toMatch(/merge-upstream.*fork-main/)
  })
})
