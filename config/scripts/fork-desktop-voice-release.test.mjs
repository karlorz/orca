import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const projectDir = resolve(import.meta.dirname, '../..')
const workflowPath = join(projectDir, '.github/workflows/fork-desktop-voice-release.yml')
const sharedWorkflowPath = join(projectDir, '.github/workflows/fork-mac-package.yml')
const releaseSource = () =>
  readFileSync(workflowPath, 'utf8') + readFileSync(sharedWorkflowPath, 'utf8')

const mobileWorkflowPath = join(projectDir, '.github/workflows/fork-mobile-voice-release.yml')

const readWorkflow = (path) => {
  if (!existsSync(path)) {
    throw new Error(`Workflow file does not exist: ${path}`)
  }
  return parse(readFileSync(path, 'utf8'))
}

describe('fork desktop voice release workflow', () => {
  it('exists, is fenced to karlorz/orca, and triggers only on v*.*.*-[0-9]* tags', () => {
    const workflow = readWorkflow(workflowPath)
    expect(workflow.on.push.tags).toEqual(['v*.*.*-[0-9]*'])
    const scripts = JSON.stringify(workflow) + JSON.stringify(readWorkflow(sharedWorkflowPath))
    expect(scripts).toContain("github.repository == 'karlorz/orca'")
    expect(scripts).not.toContain('stablyai/orca')
    expect(scripts).toContain('ORCA_FORK_VOICE_BUILD')
    expect(scripts).toContain('macos-')
    expect(scripts).toContain('--prerelease')
    expect(scripts).toContain('--latest=false')
    expect(scripts).toContain('fork-desktop-build-version.mjs')
    expect(scripts).toContain('FORK_DESKTOP_TAG')
    expect(scripts).not.toContain('orca-mobile.apk')
    expect(scripts).not.toContain('MAC_CERTS')
  })

  it('verifies tag matches v<x.y.z>-<N> shape and checks fork-main ancestry', () => {
    const rawYaml = releaseSource()
    expect(rawYaml).toContain('^refs/tags/v[0-9]+\\.[0-9]+\\.[0-9]+-[0-9]+$')
    expect(rawYaml).toContain('merge-base --is-ancestor')
  })

  it('passes generated canonical version from fork-desktop-build-version to electron-builder', () => {
    const rawYaml = releaseSource()
    expect(rawYaml).toContain('ORCA_FORK_VOICE_BUILD_VERSION: ${{ steps.version.outputs.version }}')
  })

  it('requires the downloaded orcad template to report the fork desktop version', () => {
    const rawYaml = releaseSource()
    expect(rawYaml).toContain(
      'orcad-template-app-version.mjs --assert-file out/orcad-template/out/package.json'
    )
  })

  it('builds both macOS architectures (x64 and arm64)', () => {
    const rawYaml = releaseSource()
    expect(rawYaml).not.toMatch(/electron-builder[^\n]*--mac[^\n]*--arm64/)
    expect(rawYaml).toMatch(/electron-builder[^\n]*--mac[^\n]*--publish never/)
  })

  it('widens mac CPU variants before packaging so beforePack can ship darwin/x64 from arm64', () => {
    const workflow = readWorkflow(workflowPath)
    const isWiden = (step) =>
      typeof step.run === 'string' &&
      step.run.includes('pnpm install') &&
      step.run.includes('--cpu=current,x64,arm64')
    const macSteps = readWorkflow(sharedWorkflowPath).jobs.package.steps
    const installIndex = macSteps.findIndex(
      (step) => step.uses === './.github/actions/install-node-dependencies'
    )
    const widenIndex = macSteps.findIndex(isWiden)
    expect(installIndex).toBeGreaterThanOrEqual(0)
    expect(widenIndex).toBeGreaterThan(installIndex)
    expect(workflow.jobs['build-linux'].steps.some(isWiden)).toBe(false)
    expect(workflow.jobs['build-windows'].steps.some(isWiden)).toBe(false)
  })

  it('stages all four archives, latest-mac.yml, blockmaps, and SHA256SUMS in desktop-artifacts', () => {
    const rawYaml = releaseSource()
    expect(rawYaml).toContain('orca-macos-x64.dmg')
    expect(rawYaml).toContain('orca-macos-arm64.dmg')
    expect(rawYaml).toContain('orca-macos-x64.zip')
    expect(rawYaml).toContain('orca-macos-arm64.zip')
    expect(rawYaml).toContain('latest-mac.yml')
    expect(rawYaml).toContain('dist/*.blockmap')
    expect(rawYaml).toContain('SHA256SUMS.txt')
  })

  it('runs verify-fork-desktop-release-artifacts before artifact upload to fail closed on missing manifest references', () => {
    const rawYaml = releaseSource()
    expect(rawYaml).toContain('verify-fork-desktop-release-artifacts.mjs')
  })

  it('does not share the mobile tag pattern or publish DMG onto mobile releases', () => {
    const desktop = readWorkflow(workflowPath)
    const mobile = readWorkflow(mobileWorkflowPath)
    expect(desktop.on.push.tags).not.toEqual(mobile.on.push.tags)
    expect(mobile.on.push.tags).toEqual(['mobile-android-v*.*.*-*'])
  })

  it('fails closed without fork self-signed secrets and imports that identity before electron-builder', () => {
    const rawYaml = releaseSource()
    const trustScript = join(projectDir, 'config/scripts/fork-macos-trust-self-signed-identity.sh')
    expect(existsSync(trustScript)).toBe(true)
    const trustSource = readFileSync(trustScript, 'utf8')
    expect(trustSource).toContain('create-keychain')
    expect(trustSource).toContain('find-identity')
    expect(trustSource).not.toContain('authorizationdb')
    expect(trustSource).not.toContain('add-trusted-cert')
    expect(rawYaml).toContain('timeout-minutes: 2')
    expect(rawYaml).toContain('secrets.ORCA_FORK_CSC_LINK')
    expect(rawYaml).toContain('secrets.ORCA_FORK_CSC_KEY_PASSWORD')
    expect(rawYaml).toContain('fork-macos-trust-self-signed-identity.sh')
    expect(rawYaml).toContain('CSC_NAME: Orca Fork (karlorz)')
    expect(rawYaml).toContain('ORCA_FORK_CSC_LINK')
    expect(rawYaml).toMatch(/Missing GitHub secrets ORCA_FORK_CSC/)
  })

  it('verifies the packed app is self-signed, not ad-hoc, and does not call the release unsigned', () => {
    const rawYaml = releaseSource()
    const verifier = readFileSync(
      join(projectDir, 'config/scripts/verify-fork-mac-package.mjs'),
      'utf8'
    )
    expect(verifier).toContain("['-dv', '--verbose=2', app]")
    expect(verifier).toContain('Authority=Orca Fork (karlorz)')
    expect(verifier).toContain('flags=0x2(adhoc)')
    expect(rawYaml).not.toContain('unsigned / ad-hoc')
    expect(rawYaml).toContain('self-signed')
  })

  it('builds orca-speech before electron-builder and fails closed if packed Orca.app lacks Contents/MacOS/orca-speech', () => {
    const macYaml = readFileSync(sharedWorkflowPath, 'utf8')
    const notifBuildIdx = macYaml.indexOf('pnpm run build:notification-status-macos')
    const speechBuildIdx = macYaml.indexOf('pnpm run build:speech-macos')
    const ensureIdx = macYaml.indexOf('pnpm run ensure:electron-runtime')
    const electronBuilderIdx = macYaml.indexOf('pnpm exec electron-builder')
    expect(notifBuildIdx).toBeGreaterThan(-1)
    expect(speechBuildIdx).toBeGreaterThan(notifBuildIdx)
    expect(ensureIdx).toBeGreaterThan(speechBuildIdx)
    expect(electronBuilderIdx).toBeGreaterThan(ensureIdx)
    expect(
      readFileSync(join(projectDir, 'config/scripts/verify-fork-mac-package.mjs'), 'utf8')
    ).toContain('Contents/MacOS/orca-speech')
  })

  it('includes build-linux job that builds Linux packages and verifies artifacts', () => {
    const workflow = readWorkflow(workflowPath)
    expect(workflow.jobs['build-linux']).toBeDefined()
    expect(workflow.jobs['build-linux'].needs).toContain('verify')
    expect(workflow.jobs['build-linux'].needs).toContain('orcad-template')
    const steps = workflow.jobs['build-linux'].steps
    const packageInputsIndex = steps.findIndex((step) => step.name === 'Build package inputs')
    const projectWebIndex = steps.findIndex(
      (step) => step.name === 'Project web client from renderer build'
    )
    const mobileWebIndex = steps.findIndex((step) => step.name === 'Build mobile web bundle')
    const nativeIndex = steps.findIndex((step) => step.name === 'Build native components')
    const packageIndex = steps.findIndex((step) => step.name === 'Build Linux packages')
    expect(packageInputsIndex).toBeGreaterThanOrEqual(0)
    expect(projectWebIndex).toBeGreaterThan(packageInputsIndex)
    expect(mobileWebIndex).toBeGreaterThan(projectWebIndex)
    expect(steps[mobileWebIndex]?.run).toBe('pnpm run build:mobile-web')
    expect(nativeIndex).toBeGreaterThan(mobileWebIndex)
    expect(packageIndex).toBeGreaterThan(nativeIndex)
    const rawYaml = releaseSource()
    expect(rawYaml).toContain('build-linux:')
    expect(rawYaml).toContain('ubuntu-latest')
    expect(rawYaml).toMatch(
      /electron-builder[^\n]*--linux[^\n]*AppImage[^\n]*deb[^\n]*rpm[^\n]*--publish never/
    )
    expect(rawYaml).toContain(
      'verify-fork-desktop-release-artifacts.mjs desktop-artifacts-linux --platform=linux'
    )
    expect(rawYaml).toContain('desktop-artifacts-linux')
    expect(rawYaml).toContain('scripts=(build:wsl-guest build:electron-vite:parallel)')
    expect(rawYaml).not.toContain('build:relay')
  })

  it('includes build-windows job on windows-2022 building unsigned NSIS installer and blockmap', () => {
    const workflow = readWorkflow(workflowPath)
    expect(workflow.jobs['build-windows']).toBeDefined()
    expect(workflow.jobs['build-windows'].needs).toContain('verify')
    expect(workflow.jobs['build-windows'].needs).toContain('orcad-template')
    const rawYaml = releaseSource()
    expect(rawYaml).toContain('build-windows:')
    expect(rawYaml).toContain('windows-2022')
    expect(rawYaml).toContain('build-windows-cli-launcher.mjs')
    expect(rawYaml).toContain('build-windows-process-tree-addon.mjs')
    expect(rawYaml).not.toContain('build-windows-process-tree-relay-addon.mjs')
    expect(rawYaml).toMatch(/electron-builder[^\n]*--win[^\n]*--publish never/)
    expect(rawYaml).toContain('generate-windows-blockmap.mjs')
    expect(rawYaml).toContain(
      'verify-fork-desktop-release-artifacts.mjs desktop-artifacts-windows --platform=windows'
    )
    expect(rawYaml).toContain('desktop-artifacts-windows')
  })

  it('combines mac, linux, and windows artifacts into one release with combined SHA256SUMS and fences', () => {
    const workflow = readWorkflow(workflowPath)
    const pub = workflow.jobs['publish-release']
    expect(pub.needs).toContain('verify')
    expect(pub.needs).toContain('build-mac')
    expect(pub.needs).toContain('build-linux')
    expect(pub.needs).toContain('build-windows')

    const rawYaml = releaseSource()
    expect(rawYaml).toContain('desktop-artifacts-mac')
    expect(rawYaml).toContain('desktop-artifacts-linux')
    expect(rawYaml).toContain('desktop-artifacts-windows')
    expect(rawYaml).toContain(
      'verify-fork-desktop-release-artifacts.mjs all-desktop-artifacts --platform=all'
    )
    expect(rawYaml).toContain('shasum -a 256 * > SHA256SUMS.txt')
    expect(rawYaml).toContain('Refusing overwrite')
    expect(rawYaml).toContain('--prerelease')
    expect(rawYaml).toContain('--latest=false')
  })

  it('installs node dependencies in publish-release before verifying artifacts with yaml dependency', () => {
    const workflow = readWorkflow(workflowPath)
    const steps = workflow.jobs['publish-release'].steps
    const installIndex = steps.findIndex(
      (step) => step.uses === './.github/actions/install-node-dependencies'
    )
    const verifyIndex = steps.findIndex(
      (step) =>
        typeof step.run === 'string' &&
        step.run.includes('verify-fork-desktop-release-artifacts.mjs')
    )
    expect(installIndex).toBeGreaterThanOrEqual(0)
    expect(verifyIndex).toBeGreaterThan(installIndex)
  })

  it('builds the orcad template from the tagged commit and packs it into every desktop OS', () => {
    const workflow = readWorkflow(workflowPath)
    const template = workflow.jobs['orcad-template']
    expect(template.needs).toEqual(['verify'])
    expect(template.uses).toBe('./.github/workflows/node-server-tests.yml')
    expect(template.with).toEqual({
      ref: '${{ github.sha }}',
      build_template: true,
      fast_runners: false
    })
    expect(template.permissions).toEqual({ contents: 'read', actions: 'read' })
    expect(template.secrets).toBeUndefined()
    expect(template.if).toContain("github.repository == 'karlorz/orca'")

    for (const jobName of ['build-mac', 'build-linux', 'build-windows']) {
      const job = workflow.jobs[jobName]
      expect(job.needs).toContain('orcad-template')
      expect(job.if ?? '').not.toMatch(/always\(\)|!cancelled\(\)/)
      const steps =
        jobName === 'build-mac' ? readWorkflow(sharedWorkflowPath).jobs.package.steps : job.steps
      const download = steps.find((step) => step.name === 'Download the orcad deployment template')
      expect(download?.uses).toMatch(/^actions\/download-artifact@/)
      expect(download?.with).toEqual({
        name: 'orcad-template',
        path: 'out/orcad-template'
      })
      const pack = steps.find(
        (step) =>
          typeof step.run === 'string' &&
          step.run.includes('electron-builder') &&
          step.env?.ORCA_REQUIRE_ORCAD_TEMPLATE === '1'
      )
      expect(pack).toBeDefined()
      const downloadIndex = steps.findIndex(
        (step) => step.name === 'Download the orcad deployment template'
      )
      const packIndex = steps.indexOf(pack)
      expect(packIndex).toBeGreaterThan(downloadIndex)
    }
  })
})
