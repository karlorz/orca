import { describe, expect, it } from 'vitest'
import {
  assertSafePushRemoteUrl,
  buildForkMainSyncPlan,
  resolvePushRemote
} from './fork-sync-fork-main.mjs'

describe('fork-sync-fork-main helper', () => {
  it('merges stablyai/orca main into fork-main and never uses merge-upstream on fork-main', () => {
    const plan = buildForkMainSyncPlan()
    expect(plan.workingBranch).toBe('fork-main')
    expect(plan.mirrorBranch).toBe('main')
    expect(plan.upstreamUrl).toBe('https://github.com/stablyai/orca.git')
    expect(plan.fetchArgs).toEqual(['fetch', plan.upstreamUrl, 'main'])
    expect(plan.mergeArgs.slice(0, 3)).toEqual(['merge', '--no-ff', 'FETCH_HEAD'])
    expect(plan.neverMergeUpstreamApiOnWorkingBranch).toBe(true)
  })

  it('refuses stablyai/orca push remotes and prefers fork over origin', () => {
    expect(() => assertSafePushRemoteUrl('https://github.com/stablyai/orca.git')).toThrow(
      /stablyai\/orca/
    )
    expect(
      resolvePushRemote([
        { name: 'fork', url: 'https://github.com/karlorz/orca.git' },
        { name: 'origin', url: 'https://github.com/karlorz/orca.git' }
      ])
    ).toBe('fork')
  })
})
