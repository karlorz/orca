import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const projectDir = resolve(import.meta.dirname, '../..')
const workflowPath = join(projectDir, '.github/workflows/fork-desktop-voice-release.yml')
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
    const scripts = JSON.stringify(workflow)
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
    const rawYaml = readFileSync(workflowPath, 'utf8')
    expect(rawYaml).toContain('^refs/tags/v[0-9]+\\.[0-9]+\\.[0-9]+-[0-9]+$')
    expect(rawYaml).toContain('merge-base --is-ancestor')
  })

  it('stages latest-mac.yml and optional blockmaps in desktop-artifacts', () => {
    const rawYaml = readFileSync(workflowPath, 'utf8')
    expect(rawYaml).toContain('dist/latest-mac.yml')
    expect(rawYaml).toContain('cp dist/latest-mac.yml desktop-artifacts/')
    expect(rawYaml).toContain('dist/*.blockmap')
  })

  it('does not share the mobile tag pattern or publish DMG onto mobile releases', () => {
    const desktop = readWorkflow(workflowPath)
    const mobile = readWorkflow(mobileWorkflowPath)
    expect(desktop.on.push.tags).not.toEqual(mobile.on.push.tags)
    expect(mobile.on.push.tags).toEqual(['mobile-android-v*.*.*-*'])
  })
})
