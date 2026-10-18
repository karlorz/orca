import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import {
  assertMobileLockfile,
  collectDeclaredPatches,
  findMobileLockfileProblems,
  loadMobileLockfileInputs,
  loadMobileLockfileInputsFromGit,
  lockfileSpecifiers,
  main,
  parseLockfilePrecheckRefArg,
  parseMobileLockfile
} from './fork-mobile-lockfile-precheck.mjs'

const projectDir = resolve(import.meta.dirname, '../..')
const workflowPath = join(projectDir, '.github/workflows/fork-sync-main.yml')
const scriptPath = join(projectDir, 'config/scripts/fork-mobile-lockfile-precheck.mjs')
const PATCH_PATH = 'patches/@react-native__codegen@0.83.10.patch'
const CODEGEN_KEY = '@react-native/codegen@0.83.10'

function validInput() {
  return {
    manifest: {
      dependencies: { react: '19.2.8' },
      devDependencies: { typescript: '5.9.2' }
    },
    workspace: {
      patchedDependencies: {
        [CODEGEN_KEY]: PATCH_PATH,
        'react-native@0.83.10': 'patches/react-native@0.83.10.patch'
      }
    },
    lockfile: {
      patchedDependencies: {
        [CODEGEN_KEY]: 'a'.repeat(64),
        'react-native@0.83.10': 'b'.repeat(64)
      },
      importers: {
        '.': {
          dependencies: { react: { specifier: '19.2.8', version: '19.2.8' } },
          devDependencies: { typescript: { specifier: '5.9.2', version: '5.9.2' } }
        }
      }
    },
    patchFiles: {
      [PATCH_PATH]: true,
      'patches/react-native@0.83.10.patch': true
    }
  }
}

function writeMobileTree(files) {
  const root = mkdtempSync(join(tmpdir(), 'orca-mobile-lockfile-precheck-'))
  mkdirSync(join(root, 'mobile', 'patches'), { recursive: true })
  for (const [rel, body] of Object.entries(files)) {
    const path = join(root, rel)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, body)
  }
  return root
}

function gitIn(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || args.join(' ')).trim())
  }
  return (result.stdout ?? '').trim()
}

function gitRefHasPath(cwd, ref, gitPath) {
  return (
    spawnSync('git', ['cat-file', '-e', `${ref}:${gitPath}`], { cwd, encoding: 'utf8' }).status ===
    0
  )
}

function fixtureLockfileYaml(reactSpecifier = '19.2.8') {
  return `importers:
  .:
    dependencies:
      react:
        specifier: ${reactSpecifier}
        version: ${reactSpecifier}
patchedDependencies:
  '${CODEGEN_KEY}': ${'a'.repeat(64)}
  'react-native@0.83.10': ${'b'.repeat(64)}
`
}

function fixtureMobileFiles({ lockfile = true, reactSpecifier = '19.2.8' } = {}) {
  const files = {
    'mobile/package.json': JSON.stringify(
      { dependencies: { react: '19.2.8' }, patchedDependencies: { [CODEGEN_KEY]: PATCH_PATH } },
      null,
      2
    ),
    'mobile/pnpm-workspace.yaml': `patchedDependencies:
  '${CODEGEN_KEY}': ${PATCH_PATH}
  react-native@0.83.10: patches/react-native@0.83.10.patch
`,
    [`mobile/${PATCH_PATH}`]: 'diff --git a/x b/x\n',
    'mobile/patches/react-native@0.83.10.patch': 'diff --git a/y b/y\n'
  }
  if (lockfile) {
    files['mobile/pnpm-lock.yaml'] = fixtureLockfileYaml(reactSpecifier)
  }
  return files
}

function writeTaggedMobileTree(files, tag) {
  const root = writeMobileTree(files)
  gitIn(root, ['init', '-q'])
  gitIn(root, ['config', 'user.email', 'lockfile-precheck@example.com'])
  gitIn(root, ['config', 'user.name', 'lockfile-precheck'])
  gitIn(root, ['add', '.'])
  gitIn(root, ['commit', '-qm', 'mobile lockfile fixture'])
  gitIn(root, ['tag', tag])
  return root
}

describe('findMobileLockfileProblems', () => {
  it('accepts matching specifiers, patch keys, and the codegen patch', () => {
    expect(findMobileLockfileProblems(validInput())).toEqual([])
  })

  it('reports a lockfile specifier that drifted from package.json', () => {
    const input = validInput()
    input.lockfile.importers['.'].dependencies.react.specifier = '19.1.0'
    expect(findMobileLockfileProblems(input)).toEqual([
      'mobile/pnpm-lock.yaml specifier for react is 19.1.0, expected 19.2.8 from mobile/package.json'
    ])
  })

  it('reports a package.json specifier missing from the lockfile', () => {
    const input = validInput()
    input.manifest.dependencies.expo = '^55.0.31'
    expect(findMobileLockfileProblems(input)).toEqual([
      'mobile/pnpm-lock.yaml is missing specifier expo@^55.0.31 from mobile/package.json'
    ])
  })

  it('reports an extra lockfile specifier', () => {
    const input = validInput()
    input.lockfile.importers['.'].dependencies.leftpad = {
      specifier: '1.0.0',
      version: '1.0.0'
    }
    expect(findMobileLockfileProblems(input)).toEqual([
      'mobile/pnpm-lock.yaml has extra specifier leftpad@1.0.0 that is not in mobile/package.json'
    ])
  })

  it('reports patchedDependencies keys that do not match package.json and workspace', () => {
    const input = validInput()
    input.manifest.patchedDependencies = {
      'query-string@9.5.1': 'patches/query-string@9.5.1.patch'
    }
    input.patchFiles['patches/query-string@9.5.1.patch'] = true
    expect(findMobileLockfileProblems(input)).toEqual([
      'mobile patchedDependencies keys differ: declared (@react-native/codegen@0.83.10, query-string@9.5.1, react-native@0.83.10) vs lockfile (@react-native/codegen@0.83.10, react-native@0.83.10)'
    ])
  })

  it('reports a missing @react-native/codegen patchedDependencies entry', () => {
    const input = validInput()
    delete input.workspace.patchedDependencies[CODEGEN_KEY]
    delete input.lockfile.patchedDependencies[CODEGEN_KEY]
    expect(findMobileLockfileProblems(input)).toEqual([
      'mobile/package.json and mobile/pnpm-workspace.yaml are missing a patchedDependencies entry for @react-native/codegen'
    ])
  })

  it('reports a missing codegen patch file', () => {
    const input = validInput()
    input.patchFiles[PATCH_PATH] = false
    expect(findMobileLockfileProblems(input)).toEqual([
      `mobile is missing the @react-native/codegen patch file ${PATCH_PATH}`
    ])
  })

  it('unions package.json and workspace patchedDependencies keys', () => {
    expect(
      collectDeclaredPatches(
        { patchedDependencies: { 'query-string@9.5.1': 'patches/query-string@9.5.1.patch' } },
        { patchedDependencies: { [CODEGEN_KEY]: PATCH_PATH } }
      )
    ).toEqual({
      [CODEGEN_KEY]: PATCH_PATH,
      'query-string@9.5.1': 'patches/query-string@9.5.1.patch'
    })
  })
})

describe('parseMobileLockfile', () => {
  it('uses the last pnpm 9 document for importer specifiers', () => {
    const lockfile = parseMobileLockfile(`---
lockfileVersion: '9.0'
importers:
  .:
    packageManagerDependencies:
      pnpm:
        specifier: 12.8.1
        version: 12.8.1
---
importers:
  .:
    dependencies:
      react:
        specifier: 19.2.8
        version: 19.2.8
patchedDependencies:
  '${CODEGEN_KEY}': ${'a'.repeat(64)}
`)
    expect(lockfileSpecifiers(lockfile)).toEqual({ react: '19.2.8' })
    expect(lockfile.patchedDependencies[CODEGEN_KEY]).toHaveLength(64)
  })
})

describe('checkout mobile lockfile', () => {
  it('passes against the current mobile package files', () => {
    expect(findMobileLockfileProblems(loadMobileLockfileInputs({ cwd: projectDir }))).toEqual([])
    expect(main(projectDir)).toBe(0)
  })

  it('assertMobileLockfile throws a multi-line message on a drifted tree', () => {
    const root = writeMobileTree({
      'mobile/package.json': JSON.stringify(
        { dependencies: { react: '19.2.8' }, patchedDependencies: { [CODEGEN_KEY]: PATCH_PATH } },
        null,
        2
      ),
      'mobile/pnpm-workspace.yaml': 'packages: []\n',
      'mobile/pnpm-lock.yaml': `importers:
  .:
    dependencies:
      react:
        specifier: 19.1.0
        version: 19.1.0
`,
      [`mobile/${PATCH_PATH}`]: 'diff --git a/x b/x\n'
    })
    expect(() => assertMobileLockfile({ cwd: root })).toThrow(/mobile lockfile precheck failed/)
    expect(() => assertMobileLockfile({ cwd: root })).toThrow(/specifier for react is 19.1.0/)
    expect(main(root)).toBe(1)
  })
})

describe('fork-sync runs the precheck after merge and before mobile auto-cut', () => {
  it('invokes the local script in the sync-fork-main job', () => {
    const workflow = parse(readFileSync(workflowPath, 'utf8'))
    const steps = workflow.jobs['sync-fork-main'].steps
    const mergeIdx = steps.findIndex((step) => step.id === 'merge_fork_main')
    const precheckIdx = steps.findIndex((step) =>
      String(step.run ?? '').includes('fork-mobile-lockfile-precheck.mjs')
    )
    const mobileCutIdx = steps.findIndex((step) =>
      String(step.run ?? '').includes('fork-next-mobile-tag.mjs')
    )
    expect(mergeIdx).toBeGreaterThanOrEqual(0)
    expect(precheckIdx).toBeGreaterThan(mergeIdx)
    expect(mobileCutIdx).toBeGreaterThan(precheckIdx)
    expect(steps[precheckIdx].run).toContain(
      'node config/scripts/fork-mobile-lockfile-precheck.mjs'
    )
  })

  it('exits 0 when spawned against this checkout', () => {
    const result = spawnSync(process.execPath, [scriptPath], {
      cwd: projectDir,
      encoding: 'utf8'
    })
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('mobile lockfile precheck: ok')
  })
})

describe('missing lockfile', () => {
  it('fails closed when mobile/pnpm-lock.yaml is absent from the tree', () => {
    const root = writeMobileTree(fixtureMobileFiles({ lockfile: false }))
    expect(() => loadMobileLockfileInputs({ cwd: root })).toThrow(
      /fork-mobile-lockfile-precheck: missing lockfile at .*pnpm-lock\.yaml/
    )
    expect(main(root)).toBe(1)
  })

  it('fails closed when a git tag is missing mobile/pnpm-lock.yaml', () => {
    const tag = 'mobile-android-v0.0.55-missing'
    const root = writeTaggedMobileTree(fixtureMobileFiles({ lockfile: false }), tag)
    expect(() => loadMobileLockfileInputsFromGit({ cwd: root, ref: tag })).toThrow(
      `fork-mobile-lockfile-precheck: missing lockfile at ${tag}:mobile/pnpm-lock.yaml`
    )
    expect(main(root, ['--ref', tag])).toBe(1)
  })

  it('rejects --ref without a git ref', () => {
    expect(() => parseLockfilePrecheckRefArg(['--ref'])).toThrow(/--ref requires a git ref/)
    expect(parseLockfilePrecheckRefArg([])).toBeUndefined()
  })
})

describe('stale vs tag', () => {
  it('fails when a tagged lockfile drifted from that tag package.json', () => {
    const tag = 'mobile-android-v0.0.55-stale'
    const root = writeTaggedMobileTree(fixtureMobileFiles({ reactSpecifier: '19.1.0' }), tag)
    const problems = findMobileLockfileProblems(
      loadMobileLockfileInputsFromGit({ cwd: root, ref: tag })
    )
    expect(problems).toEqual([
      'mobile/pnpm-lock.yaml specifier for react is 19.1.0, expected 19.2.8 from mobile/package.json'
    ])
    expect(main(root, ['--ref', tag])).toBe(1)
    const spawned = spawnSync(process.execPath, [scriptPath, '--ref', tag], {
      cwd: root,
      encoding: 'utf8'
    })
    expect(spawned.status).toBe(1)
    expect(spawned.stderr).toContain('specifier for react is 19.1.0')
  })

  it.skipIf(!gitRefHasPath(projectDir, 'mobile-android-v0.0.55-0', 'mobile/pnpm-lock.yaml'))(
    'fails on published mobile-android-v0.0.55-0 (outdated lockfile vs package.json)',
    () => {
      const problems = findMobileLockfileProblems(
        loadMobileLockfileInputsFromGit({ cwd: projectDir, ref: 'mobile-android-v0.0.55-0' })
      )
      expect(problems.some((problem) => problem.includes('missing specifier markdown-it'))).toBe(
        true
      )
      expect(main(projectDir, ['--ref', 'mobile-android-v0.0.55-0'])).toBe(1)
    }
  )

  it.skipIf(!gitRefHasPath(projectDir, 'mobile-android-v0.0.55-1', 'mobile/pnpm-lock.yaml'))(
    'fails on published mobile-android-v0.0.55-1 (codegen patch dropped from lockfile)',
    () => {
      const problems = findMobileLockfileProblems(
        loadMobileLockfileInputsFromGit({ cwd: projectDir, ref: 'mobile-android-v0.0.55-1' })
      )
      expect(
        problems.some((problem) => problem.includes('mobile patchedDependencies keys differ'))
      ).toBe(true)
      expect(main(projectDir, ['--ref', 'mobile-android-v0.0.55-1'])).toBe(1)
    }
  )
})

describe('clean', () => {
  it('accepts a tagged tree whose lockfile matches package.json and patches', () => {
    const tag = 'mobile-android-v0.0.55-clean'
    const root = writeTaggedMobileTree(fixtureMobileFiles(), tag)
    expect(
      findMobileLockfileProblems(loadMobileLockfileInputsFromGit({ cwd: root, ref: tag }))
    ).toEqual([])
    expect(main(root, ['--ref', tag])).toBe(0)
    const spawned = spawnSync(process.execPath, [scriptPath, '--ref', tag], {
      cwd: root,
      encoding: 'utf8'
    })
    expect(spawned.status).toBe(0)
    expect(spawned.stdout).toContain('mobile lockfile precheck: ok')
  })

  it.skipIf(!gitRefHasPath(projectDir, 'mobile-android-v0.0.55-8', 'mobile/pnpm-lock.yaml'))(
    'accepts published mobile-android-v0.0.55-8',
    () => {
      expect(
        findMobileLockfileProblems(
          loadMobileLockfileInputsFromGit({ cwd: projectDir, ref: 'mobile-android-v0.0.55-8' })
        )
      ).toEqual([])
      expect(main(projectDir, ['--ref', 'mobile-android-v0.0.55-8'])).toBe(0)
    }
  )
})
