import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  appendGitHubOutput,
  assertSafePushRemoteUrl,
  buildForkMainSyncPlan,
  isAutoResolvableSyncConflict,
  resolvePushRemote
} from './fork-sync-fork-main.mjs'
import { resolveForkMobileAppJson } from './fork-next-mobile-tag.mjs'

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

  it('auto-resolves only a mobile/app.json version conflict', () => {
    expect(isAutoResolvableSyncConflict(['mobile/app.json'])).toBe(true)
    expect(isAutoResolvableSyncConflict(['mobile/app.json', 'package.json'])).toBe(false)
    expect(isAutoResolvableSyncConflict([])).toBe(false)
  })

  it('keeps fork versionCode and published-train marketing version across app.json sync', () => {
    const ours = {
      expo: {
        version: '0.0.46',
        android: {
          versionCode: 30,
          permissions: ['RECORD_AUDIO', 'android.permission.POST_NOTIFICATIONS']
        }
      }
    }
    const theirs = {
      expo: {
        version: '0.0.47',
        android: { versionCode: 15, permissions: ['RECORD_AUDIO'] }
      }
    }
    const resolved = resolveForkMobileAppJson({ ours, theirs, trainBase: '0.0.46' })
    expect(resolved.expo.version).toBe('0.0.46')
    expect(resolved.expo.android.versionCode).toBe(30)
    expect(resolved.expo.android.permissions).toEqual([
      'RECORD_AUDIO',
      'android.permission.POST_NOTIFICATIONS'
    ])
  })

  it('appends merge SHAs to GITHUB_OUTPUT for later follow-up detection', () => {
    const outputPath = join(mkdtempSync(join(tmpdir(), 'gha-out-')), 'github_output')
    appendGitHubOutput(outputPath, {
      before: 'aaa',
      after: 'bbb',
      pushed: 'true'
    })
    expect(readFileSync(outputPath, 'utf8')).toBe('before=aaa\nafter=bbb\npushed=true\n')
  })

  it('uses the published train base even when ours still lags', () => {
    const ours = { expo: { version: '0.0.44', android: { versionCode: 29, permissions: [] } } }
    const theirs = { expo: { version: '0.0.47', android: { versionCode: 15, permissions: [] } } }
    const resolved = resolveForkMobileAppJson({ ours, theirs, trainBase: '0.0.46' })
    expect(resolved.expo.version).toBe('0.0.46')
    expect(resolved.expo.android.versionCode).toBe(29)
  })
})
