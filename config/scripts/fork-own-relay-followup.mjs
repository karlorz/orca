import { existsSync, globSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  loadOwnRelayProtocolPathConfig,
  matchingOwnRelayProtocolPaths,
  staleOwnRelayProtocolIncludeGlobs
} from './fork-own-relay-protocol-paths.mjs'

export function mergeShaShort(mergeSha) {
  const hex = String(mergeSha ?? '')
    .trim()
    .toLowerCase()
  if (!/^[0-9a-f]{8,}$/.test(hex)) {
    throw new Error(`Invalid merge SHA: ${mergeSha}`)
  }
  return hex.slice(0, 8)
}

export function findExistingFollowup(wikiRoot, mergeSha) {
  const merge8 = mergeShaShort(mergeSha)
  const captures = globSync(`raw/transcripts/*own-relay-upstream-${merge8}.md`, {
    cwd: wikiRoot
  })
  const workDirRel =
    globSync(`projects/orca/work/*own-relay-upstream-${merge8}`, {
      cwd: wikiRoot
    }).find((rel) => existsSync(join(wikiRoot, rel, 'spec.md'))) ?? null
  return {
    merge8,
    captureRel: captures.find(Boolean) ?? null,
    workDirRel
  }
}

function shaTableMarkdown(rows) {
  const lines = [
    '| SHA | Subject | Paths |',
    '|---|---|---|',
    ...(rows ?? []).map((row) => {
      const paths = (row.paths ?? []).join(', ')
      return `| \`${row.sha}\` | ${String(row.subject ?? '').replaceAll('|', '\\|')} | ${paths.replaceAll('|', '\\|')} |`
    })
  ]
  return lines.join('\n')
}

export function renderOwnRelayFollowupCapture({ merge8, ingestedDate, mergeSha, rows }) {
  return `---
source_url:
ingested: ${ingestedDate}
kind: task
project: "[[orca]]"
---

# task: own-mobile-relay protocol delta ${merge8}

Fork-sync merge \`${mergeSha}\` touched own-mobile-relay protocol/client paths. Triage on sg01 (attended). Do not auto-deploy.

${shaTableMarkdown(rows)}
`
}

export function renderOwnRelayFollowupSpec({ merge8, ingestedDate, mergeSha, rows, related = [] }) {
  const relatedLines =
    related.length === 0
      ? '_none found at file time_'
      : related.map((rel) => `- \`${rel}\``).join('\n')
  return `---
title: "Own-relay follow-up for fork-sync ${merge8}"
name: own-relay-upstream-${merge8}
kind: feature
status: planned
priority: high
project: "[[orca]]"
created: ${ingestedDate}
updated: ${ingestedDate}
started: ${ingestedDate}
provenance: project
provenance_projects: ["[[orca]]"]
tags:
  - orca
  - mobile
  - fork
---

# Spec: Own-relay follow-up ${merge8}

Auto-filed from fork-sync merge \`${mergeSha}\`. Attended sg01 only.

## SHA table

${shaTableMarkdown(rows)}

## Related open follow-ups (folder names)

${relatedLines}

## Checklist

- [ ] compatible? (own-relay already speaks this)
- [ ] port server? (change \`own-mobile-relay-*\` if needed)
- [ ] attended sg01 test
`
}

export function renderOwnRelayFollowupTasks() {
  return `# Tasks

- [ ] compatible?
- [ ] port server?
- [ ] attended sg01 test
`
}

export function listRelatedOwnRelayFollowups(wikiRoot, merge8) {
  return globSync('projects/orca/work/*own-relay-upstream-*', { cwd: wikiRoot }).filter(
    (rel) => !rel.endsWith(`own-relay-upstream-${merge8}`)
  )
}

export function planOwnRelayWikiFollowup({ wikiRoot, mergeSha, ingestedDate, rows, related }) {
  const existing = findExistingFollowup(wikiRoot, mergeSha)
  const merge8 = existing.merge8
  const relatedFolders = related ?? listRelatedOwnRelayFollowups(wikiRoot, merge8)
  if (existing.captureRel && existing.workDirRel) {
    return { action: 'skip', merge8, writes: [], existing }
  }
  const writes = []
  const workDirRel =
    existing.workDirRel ?? `projects/orca/work/${ingestedDate}-own-relay-upstream-${merge8}`
  if (!existing.captureRel) {
    writes.push({
      rel: `raw/transcripts/${ingestedDate}-task-own-relay-upstream-${merge8}.md`,
      content: renderOwnRelayFollowupCapture({ merge8, ingestedDate, mergeSha, rows })
    })
  }
  if (!existing.workDirRel) {
    writes.push({
      rel: `${workDirRel}/spec.md`,
      content: renderOwnRelayFollowupSpec({
        merge8,
        ingestedDate,
        mergeSha,
        rows,
        related: relatedFolders
      })
    })
    writes.push({
      rel: `${workDirRel}/tasks.md`,
      content: renderOwnRelayFollowupTasks()
    })
  }
  return {
    action: existing.captureRel ? 'create-work-only' : 'create',
    merge8,
    writes,
    existing
  }
}

export function applyOwnRelayWikiFollowupWrites(wikiRoot, writes) {
  for (const write of writes) {
    const abs = join(wikiRoot, write.rel)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, write.content)
  }
}

export function hongKongDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(now)
}

function gitLines(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim()
    throw new Error(`git ${args.join(' ')} failed${detail ? `: ${detail}` : ''}`)
  }
  return (result.stdout ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

function queryProtocolHitRows(repoRoot, range, matched) {
  if (matched.length === 0) {
    return { skip: true, reason: 'no-allowlist-hit', matched, rows: [] }
  }
  const logLines = gitLines(
    ['log', '--no-merges', '--format=%H\t%s', range, '--', ...matched],
    repoRoot
  )
  const rows = logLines.map((line) => {
    const [sha, ...rest] = line.split('\t')
    return { sha, subject: rest.join('\t'), paths: matched }
  })
  return { skip: false, reason: 'match', matched, rows }
}

export function simulateOwnRelayMergeDetect({ repoRoot, ours, theirs, config }) {
  if (ours === theirs) {
    return { skip: true, reason: 'noop', matched: [], rows: [] }
  }
  const mergeTree = spawnSync('git', ['merge-tree', '--write-tree', ours, theirs], {
    cwd: repoRoot,
    encoding: 'utf8'
  })
  const tree = (mergeTree.stdout ?? '').trim().split('\n')[0] ?? ''
  if (!/^[0-9a-f]{40}$/.test(tree)) {
    const detail = (mergeTree.stderr || mergeTree.stdout || '').trim()
    throw new Error(`git merge-tree --write-tree failed${detail ? `: ${detail}` : ''}`)
  }
  const changed = gitLines(['diff', '--name-only', ours, tree], repoRoot)
  return queryProtocolHitRows(
    repoRoot,
    `${ours}..${theirs}`,
    matchingOwnRelayProtocolPaths(changed, config)
  )
}

export function detectOwnRelayProtocolHits({ repoRoot, before, after, config }) {
  if (before === after) {
    return { skip: true, reason: 'noop', matched: [], rows: [] }
  }
  const stale = staleOwnRelayProtocolIncludeGlobs(repoRoot, config)
  if (stale.length > 0) {
    throw new Error(`Stale own-relay protocol include glob(s): ${stale.join(', ')}`)
  }
  const changed = gitLines(['diff', '--name-only', `${before}..${after}`], repoRoot)
  return queryProtocolHitRows(
    repoRoot,
    `${after}^1..${after}^2`,
    matchingOwnRelayProtocolPaths(changed, config)
  )
}

function readFlag(name) {
  const index = process.argv.indexOf(name)
  if (index === -1) {
    return null
  }
  return process.argv[index + 1] ?? ''
}

const invokedDirectly =
  Boolean(process.argv[1]) && process.argv[1].endsWith('fork-own-relay-followup.mjs')

if (invokedDirectly) {
  const simulate = process.argv.includes('--simulate-merge')
  const before = readFlag('--before') || readFlag('--ours')
  const after = readFlag('--after') || readFlag('--theirs')
  const wikiRoot = readFlag('--wiki')
  const write = process.argv.includes('--write')
  if (!before || !after) {
    throw new Error(
      'Usage: fork-own-relay-followup.mjs --before <sha> --after <sha> [--wiki <dir>] [--write]\n' +
        '   or: fork-own-relay-followup.mjs --simulate-merge --ours <sha> --theirs <sha>'
    )
  }
  if (simulate && write) {
    throw new Error(
      'Refusing --write with --simulate-merge (no merge SHA; would file a false follow-up)'
    )
  }
  const repoRoot = process.cwd()
  const config = loadOwnRelayProtocolPathConfig(repoRoot)
  const detection = simulate
    ? simulateOwnRelayMergeDetect({ repoRoot, ours: before, theirs: after, config })
    : detectOwnRelayProtocolHits({ repoRoot, before, after, config })
  if (detection.skip) {
    process.stdout.write(`${detection.reason}\n`)
    process.exit(0)
  }
  if (!wikiRoot) {
    process.stdout.write(`match ${detection.matched.length} path(s)\n`)
    process.exit(0)
  }
  const ingestedDate = readFlag('--ingested') || hongKongDate()
  const plan = planOwnRelayWikiFollowup({
    wikiRoot,
    mergeSha: after,
    ingestedDate,
    rows: detection.rows
  })
  process.stdout.write(`${plan.action} ${plan.merge8}\n`)
  if (write && plan.writes.length > 0) {
    applyOwnRelayWikiFollowupWrites(wikiRoot, plan.writes)
  }
}
