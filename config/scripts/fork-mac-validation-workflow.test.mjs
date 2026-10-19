import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { requireBothMacSliceEvidence, requireForkSignature } from './verify-fork-mac-package.mjs'

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
const wrapper = parse(read('.github/workflows/fork-mac-validation.yml'))
const shared = parse(read('.github/workflows/fork-mac-package.yml'))
const release = parse(read('.github/workflows/fork-desktop-voice-release.yml'))
const template = parse(read('.github/workflows/node-server-tests.yml'))
const steps = shared.jobs.package.steps
const step = (name) => steps.find((entry) => entry.name === name)

it('allows only manual validation with read-only contents and explicit two-secret mapping', () => {
  expect(Object.keys(wrapper.on)).toEqual(['workflow_dispatch'])
  expect(Object.keys(shared.on)).toEqual(['workflow_call'])
  for (const flow of [wrapper, shared]) {
    expect(flow.permissions).toEqual({ contents: 'read' })
    for (const job of Object.values(flow.jobs)) {
      expect(job.if).toContain("github.repository == 'karlorz/orca'")
      expect(job.permissions ?? flow.permissions).toEqual({ contents: 'read' })
      expect(job.secrets).not.toBe('inherit')
    }
  }
  expect(Object.keys(shared.on.workflow_call.secrets).sort()).toEqual([
    'ORCA_FORK_CSC_KEY_PASSWORD',
    'ORCA_FORK_CSC_LINK'
  ])
  expect(wrapper.jobs['validate-mac'].secrets).toEqual(release.jobs['build-mac'].secrets)
  expect(wrapper.jobs.admit.secrets).toBeUndefined()
  expect(wrapper.jobs['orcad-template'].secrets).toBeUndefined()
  expect(shared.jobs.package.if).toContain("github.event_name == 'workflow_dispatch'")
})

it('binds exact source and trusted workflow checkouts with a fresh pre-secret admission check', () => {
  expect(wrapper.jobs.admit.steps[0].with).toEqual({
    ref: '${{ github.workflow_sha }}',
    'persist-credentials': false
  })
  expect(wrapper.jobs.admit.outputs.source_sha).toBe('${{ steps.admission.outputs.source_sha }}')
  expect(steps[0].with.ref).toBe('${{ inputs.source_sha }}')
  expect(steps[0].with['persist-credentials']).toBe(false)
  expect(step('Verify exact checkout').run).toContain('git rev-parse HEAD')
  expect(step('Checkout trusted admission code').with.ref).toBe('${{ inputs.workflow_sha }}')
  const check = step('Recheck source and trusted workflow before signing')
  expect(check.run).toContain('.validation-host/config/scripts/fork-mac-validation-admission.mjs')
  expect(check.env.GITHUB_WORKFLOW_SHA).toBe('${{ github.workflow_sha }}')
  const firstSecret = steps.findIndex((entry) =>
    JSON.stringify(entry.env ?? {}).includes('secrets.')
  )
  expect(firstSecret).toBeGreaterThan(steps.indexOf(check))
  expect(firstSecret).toBe(steps.indexOf(check) + 1)
  expect(shared.jobs.package.env.CSC_LINK).toBeUndefined()
  for (const entry of steps.filter((entry) =>
    JSON.stringify(entry.env ?? {}).includes('secrets.')
  )) {
    expect(entry.env.GH_TOKEN).toBeUndefined()
  }
})

it('qualifies the same source via the unchanged template matrix and same-run download', () => {
  expect(wrapper.jobs['orcad-template'].uses).toBe('./.github/workflows/node-server-tests.yml')
  expect(wrapper.jobs['orcad-template'].with).toEqual({
    ref: '${{ needs.admit.outputs.source_sha }}',
    build_template: true,
    validation_source_sha: '${{ needs.admit.outputs.source_sha }}'
  })
  expect(wrapper.jobs['validate-mac'].needs).toEqual(['admit', 'orcad-template'])
  expect(wrapper.jobs['validate-mac'].with.source_sha).toBe('${{ needs.admit.outputs.source_sha }}')
  expect(step('Download the orcad deployment template').with).toEqual({
    name: 'orcad-template',
    path: 'out/orcad-template'
  })
  expect(step('Verify same-run template provenance').run).toContain('validation-provenance.json')
  expect(template.jobs.desktop_template.needs).toEqual([
    'persistence',
    'mobile_web_bundle',
    'linux_glibc_floor',
    'linux_glibc217_compat',
    'linux_musl'
  ])
  for (const job of template.jobs.desktop_template.needs) {
    expect(template.jobs.desktop_template.if).toContain(`needs.${job}.result == 'success'`)
  }
  const provenance = template.jobs.desktop_template.steps.find(
    (entry) => entry.name === 'Bind validation template to exact source and run'
  )
  expect(provenance.env.SOURCE_SHA).toBe('${{ inputs.validation_source_sha }}')
  expect(provenance.run).toContain('write out/orcad-template/validation-provenance.json')
})

it('keeps validation publication disabled and release Mac staging/upload names intact', () => {
  expect(wrapper.jobs['validate-mac'].with.validation).toBe(true)
  expect(release.jobs['build-mac'].with).toEqual({
    source_sha: '${{ github.sha }}',
    build_label: '${{ github.ref_name }}'
  })
  expect(release.jobs['build-mac'].uses).toBe('./.github/workflows/fork-mac-package.yml')
  for (const name of ['Stage mac artifacts', 'Upload mac artifacts']) {
    expect(step(name).if).toBe('${{ !inputs.validation }}')
  }
  expect(step('Upload mac artifacts').with.name).toBe('desktop-artifacts-mac')
  expect(step('Stage mac artifacts').run).toContain('latest-mac.yml')
  expect(step('Stage mac artifacts').run).toContain('dist/*.blockmap')
  const validationSteps = steps.filter((entry) => entry.if !== '${{ !inputs.validation }}')
  const source = JSON.stringify({ wrapper, validationSteps })
  expect(source).not.toMatch(
    /gh release|git tag|git push|contents.*write|upload-artifact|secrets.*inherit/
  )
  expect(step('Package self-signed macOS').run).toContain('--mac --publish never')
  expect(step('Package self-signed macOS').run).toContain('set -euo pipefail')
  expect(step('Package self-signed macOS').env.ORCA_REQUIRE_ORCAD_TEMPLATE).toBe('1')
})

it('preserves the Mac runner, identity, full input build, both CPU variants, and cleanup', () => {
  expect(shared.jobs.package['runs-on']).toBe('macos-15')
  expect(shared.jobs.package['timeout-minutes']).toBe(90)
  expect(shared.jobs.package.env.CI).toBe('true')
  expect(step('Widen CPU variants for mac x64 and arm64').run).toContain('--cpu=current,x64,arm64')
  expect(step('Trust fork self-signed identity').env.CSC_NAME).toBe('Orca Fork (karlorz)')
  expect(step('Trust fork self-signed identity')['timeout-minutes']).toBe(2)
  for (const command of [
    'build:desktop',
    'build:computer-macos',
    'build:keyboard-layout-macos',
    'build:notification-status-macos',
    'build:speech-macos',
    'ensure:electron-runtime'
  ]) {
    expect(step('Build app inputs').run).toContain(`pnpm run ${command}`)
  }
  expect(step('Remove temporary signing identity').if).toBe('always()')
  expect(step('Record public-safe validation result').env.CLEANUP_RESULT).toBe(
    '${{ steps.cleanup.outcome }}'
  )
  const trust = read('config/scripts/fork-macos-trust-self-signed-identity.sh')
  const cleanup = read('config/scripts/fork-macos-cleanup-identity.sh')
  expect(trust).toContain('umask 077')
  expect(trust).toContain('original-keychains.txt')
  expect(cleanup).toContain('security delete-keychain')
  expect(cleanup).toContain('security list-keychains -d user -s')
  expect(trust + cleanup).not.toMatch(/set -x|echo.*\$\{?CSC_LINK|echo.*\$\{?CSC_KEY_PASSWORD/)
})

describe('actual both-slice evidence', () => {
  const log = ['x64', 'arm64']
    .map(
      (arch) =>
        `[verify-packaged-daemon-entry] OK — ${arch} terminal host served a PTY\n[macos-terminal-host] OK — /fixture/Orca Terminal Host.app (${arch}, macOS 13.5+)`
    )
    .join('\n')
  it('requires existing actual PTY and helper signature success for each architecture', () => {
    expect(() => requireBothMacSliceEvidence(log)).not.toThrow()
    for (const line of log.split('\n')) {
      expect(() => requireBothMacSliceEvidence(log.replace(line, 'skipped'))).toThrow()
    }
    expect(() => requireBothMacSliceEvidence('echo OK 42')).toThrow()
  })
  it('requires exact existing authority and rejects ad-hoc signing', () => {
    expect(() => requireForkSignature('Authority=Orca Fork (karlorz)\n')).not.toThrow()
    expect(() => requireForkSignature('Authority=Orca Fork (karlorz) attacker')).toThrow()
    expect(() => requireForkSignature('flags=0x2(adhoc)\nAuthority=Orca Fork (karlorz)')).toThrow()
  })
  it('retains computed OK 42, 60-second deadline, signed helper clone, and required CI execution', () => {
    const verifier = read('config/scripts/verify-packaged-daemon-entry.cjs')
    expect(verifier).toContain('const TERMINAL_HOST_BOOT_TIMEOUT_MS = 60_000')
    expect(verifier).toContain('deadline: Date.now() + TERMINAL_HOST_BOOT_TIMEOUT_MS')
    expect(verifier).toContain('OK 42')
    expect(verifier).toContain("['-cR', paths.bundle, clone]")
    expect(verifier).toContain('if (required)')
    const builder = read('config/electron-builder.config.cjs')
    expect(builder).toContain("required: isMacRelease || process.env.CI === 'true'")
    expect(builder).toContain('await verifyMacTerminalHost({')
  })
})
