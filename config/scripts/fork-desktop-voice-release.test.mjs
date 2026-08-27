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
  it('exists, is fenced to karlorz/orca, and triggers only on desktop-v*.*.*-* tags', () => {
    const workflow = readWorkflow(workflowPath)
    expect(workflow.on.push.tags).toEqual(['desktop-v*.*.*-*'])
    const scripts = JSON.stringify(workflow)
    expect(scripts).toContain("github.repository == 'karlorz/orca'")
    expect(scripts).not.toContain('stablyai/orca')
    expect(scripts).toContain('ORCA_FORK_VOICE_BUILD')
    expect(scripts).toContain('macos-')
    expect(scripts).toContain('--prerelease')
    expect(scripts).toContain('--latest=false')
    expect(scripts).not.toContain('orca-mobile.apk')
    expect(scripts).not.toContain('MAC_CERTS')
  })

  it('does not share the mobile tag pattern or publish DMG onto mobile releases', () => {
    const desktop = readWorkflow(workflowPath)
    const mobile = readWorkflow(mobileWorkflowPath)
    expect(desktop.on.push.tags).not.toEqual(mobile.on.push.tags)
    expect(mobile.on.push.tags).toEqual(['mobile-android-v*.*.*-*'])
  })
})
