import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const projectDir = resolve(import.meta.dirname, '../..')
const workflowsDir = join(projectDir, '.github/workflows')

describe('tag fence audit gate', () => {
  it('fences all workflows triggered by upstream v* tags to stablyai/orca, and keeps fork desktop trigger numeric-only', () => {
    const files = readdirSync(workflowsDir).filter(
      (file) => file.endsWith('.yml') || file.endsWith('.yaml')
    )

    let desktopWorkflowChecked = false

    for (const file of files) {
      const fullPath = join(workflowsDir, file)
      const content = readFileSync(fullPath, 'utf8')
      const doc = parse(content)
      if (!doc || !doc.on) {
        continue
      }

      const pushTags = doc.on.push?.tags
      const tags = Array.isArray(pushTags) ? pushTags : pushTags ? [pushTags] : []

      if (file === 'fork-desktop-voice-release.yml') {
        expect(tags).toEqual(['v*.*.*-[0-9]*'])
        desktopWorkflowChecked = true
        continue
      }

      const matchesUpstreamVTag = tags.some((pattern) => {
        const str = String(pattern).trim()
        if (str === 'v*.*.*-[0-9]*') {
          return false
        }
        return str.startsWith('v') || str.startsWith('*')
      })

      if (matchesUpstreamVTag) {
        const jobs = doc.jobs ?? {}
        for (const [jobId, jobDef] of Object.entries(jobs)) {
          const condition = String(jobDef?.if ?? '')
          expect(
            condition,
            `Workflow ${file} job ${jobId} must be fenced to stablyai/orca because it triggers on tags matching upstream releases: ${tags.join(', ')}`
          ).toContain("github.repository == 'stablyai/orca'")
        }
      }
    }

    expect(desktopWorkflowChecked).toBe(true)
  })
})
