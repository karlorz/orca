import { readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { listForkFeatures, loadForkFeatures } from './fork-features.mjs'

const projectDir = resolve(import.meta.dirname, '../..')
const workflowPath = join(projectDir, '.github/workflows/fork-sync-main.yml')
const featuresPath = join(projectDir, 'config/fork-features.yml')

describe('fork-sync-main workflow', () => {
  it('exists and only fast-forwards karlorz/orca main from stablyai/orca', () => {
    expect(existsSync(workflowPath)).toBe(true)
    const workflow = parse(readFileSync(workflowPath, 'utf8'))
    expect(workflow.on.schedule).toEqual([{ cron: '17 1 * * *' }])
    expect(workflow.on.workflow_dispatch).toEqual({})
    expect(workflow.permissions.contents).toBe('write')

    const job = workflow.jobs['sync-main']
    expect(job.if).toBe("github.repository == 'karlorz/orca'")

    expect(job.steps[0].env.GH_TOKEN).toBe('${{ secrets.FORK_SYNC_TOKEN }}')
    const script = job.steps[0].run
    expect(script).toContain('MIRROR_BRANCH=main')
    expect(script).toContain('merge-upstream')
    expect(script).toContain('-f branch=')
    expect(script).toContain('FORK_SYNC_TOKEN')
    expect(script).not.toMatch(/MIRROR_BRANCH=fork-main/)
    expect(script).not.toMatch(/merge-upstream.*fork-main/)
  })

  it('merges stablyai/orca main into fork-main after the main mirror job', () => {
    const workflow = parse(readFileSync(workflowPath, 'utf8'))
    const job = workflow.jobs['sync-fork-main']
    expect(job).toBeTruthy()
    expect(job.if).toBe("github.repository == 'karlorz/orca'")
    expect(job.needs).toBe('sync-main')
    const scripts = job.steps.map((step) => JSON.stringify(step)).join('\n')
    expect(scripts).toContain('fork-sync-fork-main.mjs')
    expect(scripts).toContain('--write')
    expect(scripts).toContain('fork-sync-upstream-tags.mjs')
    expect(scripts).toContain('fork-next-desktop-tag.mjs')
    expect(scripts).toContain('fork-next-mobile-tag.mjs')
    expect(scripts).not.toMatch(/MIRROR_BRANCH=fork-main/)
    expect(scripts).not.toMatch(/merge-upstream/)

    // Auto-cut must skip bases the fork already tagged; --write alone would
    // re-cut v<base>-(N+1) on every daily run.
    const autoCutStep = job.steps.find((step) =>
      String(step.run ?? '').includes('fork-next-desktop-tag.mjs')
    )
    expect(autoCutStep.run).toContain('--auto')
    expect(autoCutStep.run).not.toContain('--write')

    const mobileCutStep = job.steps.find((step) =>
      String(step.run ?? '').includes('fork-next-mobile-tag.mjs')
    )
    expect(mobileCutStep.run).toContain('--auto')
    expect(mobileCutStep.run).not.toContain('--write')
  })

  it('files a wiki own-relay follow-up from the captured merge SHA', () => {
    const workflow = parse(readFileSync(workflowPath, 'utf8'))
    const mergeJob = workflow.jobs['sync-fork-main']
    expect(mergeJob.outputs.before).toBe('${{ steps.merge_fork_main.outputs.before }}')
    expect(mergeJob.outputs.after).toBe('${{ steps.merge_fork_main.outputs.after }}')
    expect(mergeJob.outputs.pushed).toBe('${{ steps.merge_fork_main.outputs.pushed }}')
    const mergeStep = mergeJob.steps.find((step) => step.id === 'merge_fork_main')
    expect(mergeStep).toBeTruthy()

    const follow = workflow.jobs['own-relay-followup']
    expect(follow.needs).toBe('sync-fork-main')
    expect(follow.if).toContain("needs.sync-fork-main.outputs.pushed == 'true'")
    const blob = JSON.stringify(follow)
    expect(blob).toContain('fork-own-relay-followup.mjs')
    expect(blob).toContain('WIKI_FOLLOWUP_TOKEN')
    expect(blob).not.toContain('FORK_SYNC_TOKEN')
    expect(blob).toContain('needs.sync-fork-main.outputs.after')
    expect(blob).toContain('needs.sync-fork-main.outputs.before')
  })
})

describe('fork-features registry', () => {
  it('loads unique landed features with required fields', () => {
    expect(existsSync(featuresPath)).toBe(true)
    const registry = loadForkFeatures(featuresPath)
    expect(registry.fork.workingBranch).toBe('fork-main')
    expect(registry.fork.mirrorBranch).toBe('main')
    expect(registry.fork.upstream).toBe('stablyai/orca')
    expect(registry.features.length).toBeGreaterThan(0)

    const ids = new Set()
    for (const feature of registry.features) {
      expect(feature.id).toMatch(/^[a-z0-9-]+$/)
      expect(feature.title.length).toBeGreaterThan(0)
      expect(['product', 'release', 'ci', 'docs']).toContain(feature.kind)
      expect(['landed', 'in-progress']).toContain(feature.status)
      expect(ids.has(feature.id)).toBe(false)
      ids.add(feature.id)
    }
  })

  it('lists pet-voice FGS hysteresis as a landed product feature', () => {
    const rows = listForkFeatures(featuresPath)
    expect(rows.some((row) => row.includes('pet-voice-fgs-hysteresis'))).toBe(true)
    expect(rows.some((row) => row.includes('landed'))).toBe(true)
  })

  it('records pet-speech-test-voice-selection as a landed product feature inventory entry', () => {
    const registry = loadForkFeatures(featuresPath)
    const entry = registry.features.find((f) => f.id === 'pet-speech-test-voice-selection')
    expect(entry).toBeDefined()
    expect(entry.kind).toBe('product')
    expect(entry.status).toBe('landed')
    expect(entry.title).toBeTruthy()
    expect(entry.paths).toEqual(
      expect.arrayContaining([
        'mobile/src/pet-speak',
        'mobile/app/pet-speech-settings.tsx',
        'mobile/packages/expo-pet-speech'
      ])
    )
    expect(entry.wiki).toBe(
      'projects/grok-desktop-pet/work/2026-08-29-mobile-owned-pet-speech-settings'
    )
  })

  it('records pet-speech-live-local-preferences as a landed product feature inventory entry', () => {
    const registry = loadForkFeatures(featuresPath)
    const entry = registry.features.find((f) => f.id === 'pet-speech-live-local-preferences')
    expect(entry).toBeDefined()
    expect(entry.kind).toBe('product')
    expect(entry.status).toBe('landed')
    expect(entry.title).toContain('device-local voice and rate')
    expect(entry.paths).toEqual(['mobile/src/pet-speak'])
    expect(entry.wiki).toBe(
      'projects/grok-desktop-pet/work/2026-08-29-mobile-owned-pet-speech-settings'
    )
  })
})
