import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  findExistingFollowup,
  mergeShaShort,
  planOwnRelayWikiFollowup,
  renderOwnRelayFollowupCapture,
  renderOwnRelayFollowupSpec,
  simulateOwnRelayMergeDetect
} from './fork-own-relay-followup.mjs'

function wikiTree() {
  return mkdtempSync(join(tmpdir(), 'own-relay-followup-'))
}

describe('own-relay follow-up planner', () => {
  it('keys idempotency on merge8 even when the capture date is not today', () => {
    const root = wikiTree()
    const mergeSha = 'aabbccddeeff00112233'
    mkdirSync(join(root, 'raw/transcripts'), { recursive: true })
    writeFileSync(
      join(root, 'raw/transcripts/2026-01-01-task-own-relay-upstream-aabbccdd.md'),
      '---\nkind: task\n---\n'
    )
    const found = findExistingFollowup(root, mergeSha)
    expect(found.captureRel).toBe('raw/transcripts/2026-01-01-task-own-relay-upstream-aabbccdd.md')
    expect(found.workDirRel).toBeNull()
  })

  it('does not file a second capture when only the work folder is missing', () => {
    const root = wikiTree()
    const mergeSha = 'aabbccddeeff00112233'
    mkdirSync(join(root, 'raw/transcripts'), { recursive: true })
    writeFileSync(
      join(root, 'raw/transcripts/2026-01-01-task-own-relay-upstream-aabbccdd.md'),
      '---\nkind: task\n---\n'
    )
    const plan = planOwnRelayWikiFollowup({
      wikiRoot: root,
      mergeSha,
      ingestedDate: '2026-08-31',
      rows: [
        {
          sha: '11111111',
          subject: 'feat: e2ee',
          paths: ['src/shared/mobile-relay-phone-protocol.ts']
        }
      ]
    })
    expect(plan.action).toBe('create-work-only')
    expect(plan.writes.some((write) => write.rel.startsWith('raw/transcripts/'))).toBe(false)
    expect(
      plan.writes.some((write) => write.rel.includes('own-relay-upstream-aabbccdd/spec.md'))
    ).toBe(true)
  })

  it('skips entirely when capture and work folder already exist', () => {
    const root = wikiTree()
    const mergeSha = 'aabbccddeeff00112233'
    mkdirSync(join(root, 'raw/transcripts'), { recursive: true })
    mkdirSync(join(root, 'projects/orca/work/2026-01-01-own-relay-upstream-aabbccdd'), {
      recursive: true
    })
    writeFileSync(join(root, 'raw/transcripts/2026-01-01-task-own-relay-upstream-aabbccdd.md'), 'x')
    writeFileSync(
      join(root, 'projects/orca/work/2026-01-01-own-relay-upstream-aabbccdd/spec.md'),
      'x'
    )
    const plan = planOwnRelayWikiFollowup({
      wikiRoot: root,
      mergeSha,
      ingestedDate: '2026-08-31',
      rows: []
    })
    expect(plan.action).toBe('skip')
    expect(plan.writes).toEqual([])
  })

  it('renders capture frontmatter and a SHA table', () => {
    const body = renderOwnRelayFollowupCapture({
      merge8: 'aabbccdd',
      ingestedDate: '2026-08-31',
      mergeSha: 'aabbccddeeff0011',
      rows: [
        {
          sha: '11111111aaaa',
          subject: 'feat: phone protocol',
          paths: ['src/shared/mobile-relay-phone-protocol.ts']
        }
      ]
    })
    expect(body).toContain('kind: task')
    expect(body).toContain('project: "[[orca]]"')
    expect(body).toContain('ingested: 2026-08-31')
    expect(body).toContain('11111111aaaa')
    expect(body).toContain('src/shared/mobile-relay-phone-protocol.ts')
    expect(body).not.toContain('BEGIN')
  })

  it('renders a work spec with the required checklist', () => {
    const spec = renderOwnRelayFollowupSpec({
      merge8: 'aabbccdd',
      ingestedDate: '2026-08-31',
      mergeSha: 'aabbccddeeff0011',
      rows: [
        {
          sha: '11111111aaaa',
          subject: 'feat: host proof',
          paths: ['src/main/runtime/relay/relay-host-proof.ts']
        }
      ]
    })
    expect(spec).toContain('kind: feature')
    expect(spec).toContain('status: planned')
    expect(spec).toContain('compatible?')
    expect(spec).toContain('attended sg01')
  })

  it('shortens merge SHAs to 8 hex chars', () => {
    expect(mergeShaShort('aabbccddeeff0011')).toBe('aabbccdd')
  })
})

describe('simulate-merge detect (tip-diff is the wrong gate)', () => {
  it('does not file when only fork-side extras differ and upstream did not touch allowlisted paths', () => {
    const root = mkdtempSync(join(tmpdir(), 'simulate-merge-'))
    function git(args) {
      const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' })
      if (r.status !== 0) {
        throw new Error(r.stderr || r.stdout)
      }
      return r.stdout.trim()
    }
    git(['init', '-q'])
    git(['config', 'user.email', 't@example.com'])
    git(['config', 'user.name', 't'])
    mkdirSync(join(root, 'src/shared'), { recursive: true })
    writeFileSync(join(root, 'src/shared/mobile-relay-phone-protocol.ts'), 'upstream-base\n')
    git(['add', '.'])
    git(['commit', '-qm', 'base'])
    const base = git(['rev-parse', 'HEAD'])
    writeFileSync(join(root, 'src/shared/mobile-relay-phone-protocol.ts'), 'fork-extra\n')
    git(['add', '.'])
    git(['commit', '-qm', 'fork extras'])
    const ours = git(['rev-parse', 'HEAD'])
    git(['checkout', '-q', '-b', 'theirs', base])
    writeFileSync(join(root, 'README.md'), 'upstream only\n')
    git(['add', '.'])
    git(['commit', '-qm', 'upstream unrelated'])
    const theirs = git(['rev-parse', 'HEAD'])
    const config = { include: ['src/shared/mobile-relay-*'], exclude: ['**/own-mobile-relay-*'] }
    const detection = simulateOwnRelayMergeDetect({
      repoRoot: root,
      ours,
      theirs,
      config
    })
    expect(detection.skip).toBe(true)
    expect(detection.reason).toBe('no-allowlist-hit')
    expect(detection.matched).toEqual([])
    expect(detection.rows).toEqual([])
  })
})
