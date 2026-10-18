#!/usr/bin/env node
// Fail closed when mobile/pnpm-lock.yaml drifts from package.json / workspace patches.

import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
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

export function loadMobileLockfileInputs({ cwd } = {}) {
  const root = cwd ?? process.cwd()
  const mobileRoot = join(root, 'mobile')
  const paths = {
    manifest: join(mobileRoot, 'package.json'),
    workspace: join(mobileRoot, 'pnpm-workspace.yaml'),
    lockfile: join(mobileRoot, 'pnpm-lock.yaml')
  }
  for (const [label, path] of Object.entries(paths)) {
    if (!existsSync(path)) {
      throw new Error(`fork-mobile-lockfile-precheck: missing ${label} at ${path}`)
    }
  }
  const manifest = JSON.parse(readFileSync(paths.manifest, 'utf8'))
  const workspace = parse(readFileSync(paths.workspace, 'utf8'))
  const lockfile = parseMobileLockfile(readFileSync(paths.lockfile, 'utf8'))
  const declaredPatches = collectDeclaredPatches(manifest, workspace)
  const patchFiles = {}
  for (const rel of Object.values(declaredPatches)) {
    if (typeof rel === 'string' && rel.length > 0) {
      patchFiles[rel] = existsSync(join(mobileRoot, rel))
    }
  }
  return { manifest, workspace, lockfile, patchFiles }
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

export function main(root = resolve(import.meta.dirname, '../..')) {
  try {
    const problems = findMobileLockfileProblems(loadMobileLockfileInputs({ cwd: root }))
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
  process.exit(main())
}
