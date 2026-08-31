import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  findExistingFollowup,
  mergeShaShort,
  planOwnRelayWikiFollowup,
  renderOwnRelayFollowupCapture,
  renderOwnRelayFollowupSpec
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
