import { lstat } from 'node:fs/promises'
import { join } from 'node:path'
import type { Repo } from '../../shared/repo-types'
import type {
  SkillFreshnessInstallation,
  SkillFreshnessInventory,
  SkillFreshnessScanIssue
} from '../../shared/skill-freshness'
import { buildSkillDiscoverySources, type SkillScanRoot } from './skill-discovery-sources'
import { loadSkillBundleManifest } from './skill-bundle-artifacts'
import { eligibleSkillUpdateNames } from './skill-freshness-eligibility'
import { runSkillCandidateTasks } from './skill-candidate-concurrency'
import {
  classifyHomeSkillCandidate,
  classifyUnsupportedSkillCandidate,
  dedupeSkillFreshnessPlacements,
  type CandidateLstat
} from './skill-freshness-placement-observation'
import { scanKnownPluginSkillCandidates } from './skill-plugin-cache-scan'
import { readSkillLockSources } from './skill-lock-sources'

export const MAXIMUM_REPOSITORY_SKILL_ROOTS = 128

export function boundRepositorySkillRoots(roots: readonly SkillScanRoot[]): {
  scanned: SkillScanRoot[]
  omitted: SkillScanRoot[]
} {
  return {
    scanned: roots.slice(0, MAXIMUM_REPOSITORY_SKILL_ROOTS),
    omitted: roots.slice(MAXIMUM_REPOSITORY_SKILL_ROOTS)
  }
}

async function presentRepositorySkillRoots(
  roots: readonly SkillScanRoot[],
  candidateLstat: CandidateLstat
): Promise<SkillScanRoot[]> {
  const presence = await Promise.all(
    roots.map(async (root) => {
      try {
        const stats = await candidateLstat(root.path)
        return stats.isDirectory() || stats.isSymbolicLink() ? root : null
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
          return null
        }
        return root
      }
    })
  )
  return presence.filter((root): root is SkillScanRoot => root !== null)
}

export async function inventorySkillFreshness(args: {
  homeDir?: string
  cwd?: string
  repos?: Repo[]
  resourceRoot?: string
  candidateLstat?: CandidateLstat
  stateHome?: string | null
}): Promise<SkillFreshnessInventory> {
  const [manifest, lockSources] = await Promise.all([
    loadSkillBundleManifest(args.resourceRoot),
    readSkillLockSources({ homeDir: args.homeDir, stateHome: args.stateHome })
  ])
  const currentByName = new Map(manifest.skills.map((skill) => [skill.name, skill]))
  const lockSourceOf = (name: string): string | null => lockSources.get(name) ?? null
  const discoveryArgs = {
    homeDir: args.homeDir,
    cwd: args.cwd,
    repos: args.repos,
    // Why: freshness scans known repositories explicitly; treating the app's
    // launch cwd as another repo would create phantom poison placements.
    includeCwd: false
  }
  const roots = buildSkillDiscoverySources(discoveryArgs)
  const homeRoots = roots.filter((root) => root.sourceKind === 'home')
  const allRepoRoots = roots.filter((root) => root.sourceKind === 'repo')
  const pluginRoots = roots.filter((root) => root.sourceKind === 'plugin')
  const canonicalRootPath = homeRoots.find((root) => root.id === 'home-agents')?.path
  if (!canonicalRootPath) {
    throw new Error('Missing canonical agent skills root')
  }

  const candidateLstat = args.candidateLstat ?? ((path) => lstat(path))
  const homeTasks = manifest.skills.flatMap((current) =>
    homeRoots.map(
      (root) => () =>
        classifyHomeSkillCandidate({
          root,
          current,
          lockSource: lockSourceOf(current.name),
          canonicalRootPath,
          candidateLstat
        })
    )
  )
  const knownSkillNames = new Set(currentByName.keys())
  // Why: presence, home hashing, and the plugin walk do not depend on each
  // other. The 128-root cap only applies to repo folders that actually exist;
  // missing provider roots used to exhaust it and show up as inaccessible copies.
  const [presentRepoRoots, homeInstallations, pluginScans] = await Promise.all([
    presentRepositorySkillRoots(allRepoRoots, candidateLstat),
    runSkillCandidateTasks(homeTasks).then((results) =>
      results.filter(
        (installation): installation is SkillFreshnessInstallation => installation !== null
      )
    ),
    Promise.all(
      pluginRoots.map(async (root) => ({
        root,
        scan: await scanKnownPluginSkillCandidates(root.path, knownSkillNames)
      }))
    )
  ])
  const { scanned: repoRoots, omitted: omittedRepoRoots } =
    boundRepositorySkillRoots(presentRepoRoots)
  const repoTasks = manifest.skills.flatMap((current) =>
    repoRoots.map(
      (root) => () =>
        classifyUnsupportedSkillCandidate({
          root,
          current,
          lockSource: lockSourceOf(current.name),
          unresolvedPath: join(root.path, current.name),
          candidateLstat
        })
    )
  )
  const omittedRoot = omittedRepoRoots[0]
  const repositoryLimitIssues: SkillFreshnessScanIssue[] =
    omittedRoot === undefined
      ? []
      : [
          {
            rootId: 'repo-scan-limit',
            sourceLabel: 'Additional repositories',
            path: omittedRoot.path,
            reason: 'repository-limit',
            errorCode: null
          }
        ]
  const pluginTasks = pluginScans.flatMap(({ root, scan }) =>
    scan.candidates.flatMap((candidate) => {
      const current = currentByName.get(candidate.name)
      return current
        ? [
            () =>
              classifyUnsupportedSkillCandidate({
                root,
                current,
                lockSource: lockSourceOf(current.name),
                unresolvedPath: candidate.path,
                candidateLstat
              })
          ]
        : []
    })
  )
  const scanIssues = [
    ...repositoryLimitIssues,
    ...pluginScans.flatMap(({ root, scan }) =>
      scan.issues.map((issue) => ({
        rootId: root.id,
        sourceLabel: root.label,
        ...issue
      }))
    )
  ]
  const unsupportedInstallations = (
    await runSkillCandidateTasks([...repoTasks, ...pluginTasks])
  ).filter((installation): installation is SkillFreshnessInstallation => installation !== null)
  const installations = dedupeSkillFreshnessPlacements([
    ...homeInstallations,
    ...unsupportedInstallations
  ]).sort(
    (left, right) =>
      left.name.localeCompare(right.name, 'en') ||
      left.unresolvedPath.localeCompare(right.unresolvedPath, 'en')
  )

  return {
    schemaVersion: 1,
    installations,
    eligibleUpdateNames: eligibleSkillUpdateNames(installations),
    scanIssues,
    scannedAt: Date.now()
  }
}
