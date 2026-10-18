#!/usr/bin/env node
// Fail closed when mobile/pnpm-lock.yaml drifts from package.json / workspace patches.

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, posix, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parse, parseAllDocuments } from 'yaml'

export const CODEGEN_PATCH_PREFIX = '@react-native/codegen@'

const SPECIFIER_KINDS = ['dependencies', 'devDependencies', 'optionalDependencies']

export function collectDeclaredPatches(manifest, workspace) {
  return {
    ...workspace?.patchedDependencies,
    ...manifest?.pnpm?.patchedDependencies,
    ...manifest?.patchedDependencies
  }
}

export function manifestSpecifiers(manifest) {
  return {
    ...manifest?.dependencies,
    ...manifest?.devDependencies,
    ...manifest?.optionalDependencies
  }
}

export function lockfileSpecifiers(lockfile) {
  const importer = lockfile?.importers?.['.'] ?? {}
  const specifiers = {}
  for (const kind of SPECIFIER_KINDS) {
    for (const [name, meta] of Object.entries(importer[kind] ?? {})) {
      specifiers[name] = meta?.specifier
    }
  }
  return specifiers
}

export function parseMobileLockfile(lockfileText) {
  const documents = parseAllDocuments(String(lockfileText ?? ''))
  let project = {}
  for (const document of documents) {
    if (document.errors.length > 0) {
      throw document.errors[0]
    }
    project = document.toJS() ?? project
  }
  return project
}

function sortedKeys(value) {
  return Object.keys(value ?? {}).sort()
}

function formatKeyList(keys) {
  return keys.length > 0 ? keys.join(', ') : 'none'
}

export function findMobileLockfileProblems({
  manifest,
  workspace,
  lockfile,
  patchFiles = {}
} = {}) {
  const problems = []
  const expectedSpecifiers = manifestSpecifiers(manifest)
  const actualSpecifiers = lockfileSpecifiers(lockfile)
  const specifierNames = new Set([
    ...Object.keys(expectedSpecifiers),
    ...Object.keys(actualSpecifiers)
  ])
  for (const name of [...specifierNames].sort()) {
    const expected = expectedSpecifiers[name]
    const actual = actualSpecifiers[name]
    if (expected === undefined) {
      problems.push(
        `mobile/pnpm-lock.yaml has extra specifier ${name}@${actual} that is not in mobile/package.json`
      )
    } else if (actual === undefined) {
      problems.push(
        `mobile/pnpm-lock.yaml is missing specifier ${name}@${expected} from mobile/package.json`
      )
    } else if (expected !== actual) {
      problems.push(
        `mobile/pnpm-lock.yaml specifier for ${name} is ${actual}, expected ${expected} from mobile/package.json`
      )
    }
  }

  const declaredPatches = collectDeclaredPatches(manifest, workspace)
  const declaredKeys = sortedKeys(declaredPatches)
  const lockPatchKeys = sortedKeys(lockfile?.patchedDependencies)
  if (declaredKeys.join('\0') !== lockPatchKeys.join('\0')) {
    problems.push(
      `mobile patchedDependencies keys differ: declared (${formatKeyList(declaredKeys)}) vs lockfile (${formatKeyList(lockPatchKeys)})`
    )
  }

  const codegenKeys = declaredKeys.filter((key) => key.startsWith(CODEGEN_PATCH_PREFIX))
  if (codegenKeys.length === 0) {
    problems.push(
      'mobile/package.json and mobile/pnpm-workspace.yaml are missing a patchedDependencies entry for @react-native/codegen'
    )
  } else {
    for (const key of codegenKeys) {
      if (!Object.hasOwn(lockfile?.patchedDependencies ?? {}, key)) {
        problems.push(`mobile/pnpm-lock.yaml is missing patchedDependencies key ${key}`)
      }
      const patchPath = declaredPatches[key]
      if (!patchPath) {
        problems.push(`declared @react-native/codegen patch ${key} has no patch path`)
        continue
      }
      if (patchFiles[patchPath] !== true) {
        problems.push(`mobile is missing the @react-native/codegen patch file ${patchPath}`)
      }
    }
  }

  return problems
}

const MOBILE_INPUT_PATHS = {
  manifest: 'mobile/package.json',
  workspace: 'mobile/pnpm-workspace.yaml',
  lockfile: 'mobile/pnpm-lock.yaml'
}

function gitMobilePath(rel) {
  return posix.join('mobile', String(rel).split(/[\\/]/).join('/'))
}

function gitRun(args, cwd) {
  return spawnSync('git', args, {
    encoding: 'utf8',
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 8 * 1024 * 1024
  })
}

function gitShow(cwd, ref, gitPath) {
  const result = gitRun(['show', `${ref}:${gitPath}`], cwd)
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim()
    throw new Error(
      `fork-mobile-lockfile-precheck: missing ${gitPath} at ${ref}${detail ? `: ${detail}` : ''}`
    )
  }
  return result.stdout ?? ''
}

function gitPathExists(cwd, ref, gitPath) {
  return gitRun(['cat-file', '-e', `${ref}:${gitPath}`], cwd).status === 0
}

function assembleMobileLockfileInputs({ exists, readText, missingAt }) {
  for (const [label, rel] of Object.entries(MOBILE_INPUT_PATHS)) {
    if (!exists(rel)) {
      throw new Error(`fork-mobile-lockfile-precheck: missing ${label} at ${missingAt(rel)}`)
    }
  }
  const manifest = JSON.parse(readText(MOBILE_INPUT_PATHS.manifest))
  const workspace = parse(readText(MOBILE_INPUT_PATHS.workspace))
  const lockfile = parseMobileLockfile(readText(MOBILE_INPUT_PATHS.lockfile))
  const declaredPatches = collectDeclaredPatches(manifest, workspace)
  const patchFiles = {}
  for (const rel of Object.values(declaredPatches)) {
    if (typeof rel === 'string' && rel.length > 0) {
      patchFiles[rel] = exists(gitMobilePath(rel))
    }
  }
  return { manifest, workspace, lockfile, patchFiles }
}

export function loadMobileLockfileInputs({ cwd } = {}) {
  const root = cwd ?? process.cwd()
  return assembleMobileLockfileInputs({
    exists: (rel) => existsSync(join(root, rel)),
    readText: (rel) => readFileSync(join(root, rel), 'utf8'),
    missingAt: (rel) => join(root, rel)
  })
}

export function parseLockfilePrecheckRefArg(argv = []) {
  const idx = argv.indexOf('--ref')
  if (idx === -1) {
    return undefined
  }
  const ref = argv[idx + 1]
  if (!ref || String(ref).startsWith('-')) {
    throw new Error('fork-mobile-lockfile-precheck: --ref requires a git ref')
  }
  return String(ref).trim()
}

export function loadMobileLockfileInputsFromGit({ cwd, ref } = {}) {
  const root = cwd ?? process.cwd()
  const spec = String(ref ?? '').trim()
  if (!spec) {
    throw new Error('fork-mobile-lockfile-precheck: git ref is required')
  }
  return assembleMobileLockfileInputs({
    exists: (rel) => gitPathExists(root, spec, rel),
    readText: (rel) => gitShow(root, spec, rel),
    missingAt: (rel) => `${spec}:${rel}`
  })
}

export function assertMobileLockfile({ cwd } = {}) {
  const problems = findMobileLockfileProblems(loadMobileLockfileInputs({ cwd }))
  if (problems.length > 0) {
    throw new Error(
      [
        'mobile lockfile precheck failed:',
        ...problems.map((problem) => `- ${problem}`),
        'Refresh mobile/pnpm-lock.yaml from mobile/package.json and mobile/pnpm-workspace.yaml, and keep the @react-native/codegen patch.'
      ].join('\n')
    )
  }
}

export function main(root = resolve(import.meta.dirname, '../..'), argv = process.argv.slice(2)) {
  try {
    const ref = parseLockfilePrecheckRefArg(argv)
    const inputs = ref
      ? loadMobileLockfileInputsFromGit({ cwd: root, ref })
      : loadMobileLockfileInputs({ cwd: root })
    const problems = findMobileLockfileProblems(inputs)
    if (problems.length > 0) {
      console.error('mobile lockfile precheck failed:')
      for (const problem of problems) {
        console.error(`- ${problem}`)
      }
      console.error(
        'Refresh mobile/pnpm-lock.yaml from mobile/package.json and mobile/pnpm-workspace.yaml, and keep the @react-native/codegen patch.'
      )
      return 1
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    return 1
  }
  console.log('mobile lockfile precheck: ok')
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.cwd()))
}
