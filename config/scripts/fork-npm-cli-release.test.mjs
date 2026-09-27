import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const projectDir = resolve(import.meta.dirname, '../..')
const workflowPath = join(projectDir, '.github/workflows/fork-npm-cli-release.yml')
const rootPackageJsonPath = join(projectDir, 'package.json')
const cliPackageJsonPath = join(projectDir, 'packages/orca-cli/package.json')

const workflow = parse(readFileSync(workflowPath, 'utf8'))
const rootPackageJson = JSON.parse(readFileSync(rootPackageJsonPath, 'utf8'))
const cliPackageJson = JSON.parse(readFileSync(cliPackageJsonPath, 'utf8'))

describe('fork npm CLI release setup', () => {
  it('fences every publish job to karlorz/orca and fork-main', () => {
    const jobs = Object.values(workflow.jobs ?? {})
    expect(jobs.length).toBeGreaterThan(0)
    for (const job of jobs) {
      expect(job.if).toBe(
        "github.repository == 'karlorz/orca' && github.ref == 'refs/heads/fork-main'"
      )
    }
  })

  it('declares permissions with id-token write and contents read', () => {
    expect(workflow.permissions).toEqual({
      contents: 'read',
      'id-token': 'write'
    })
  })

  it('configures every job to use the npm environment', () => {
    const jobs = Object.values(workflow.jobs ?? {})
    expect(jobs.length).toBeGreaterThan(0)
    for (const job of jobs) {
      expect(job.environment).toBe('npm')
    }
  })

  it('keeps root package private so release jobs never publish the full application tree', () => {
    expect(rootPackageJson.private).toBe(true)
  })

  it('names the published CLI package @karlorz/orca-cli with public access and provenance configured', () => {
    expect(cliPackageJson.name).toBe('@karlorz/orca-cli')
    expect(cliPackageJson.publishConfig).toEqual({
      access: 'public',
      provenance: true
    })
  })

  it('targets public access and the selected input distribution tag in publish step', () => {
    const publishJob = workflow.jobs.publish
    const publishStep = publishJob.steps.find(
      (step) => typeof step.run === 'string' && step.run.includes('npm publish')
    )
    expect(publishStep).toBeDefined()
    expect(publishStep.workingDirectory ?? publishStep['working-directory']).toBe(
      'packages/orca-cli'
    )
    expect(publishStep.env?.NPM_CONFIG_PROVENANCE).toBe('true')
    expect(publishStep.run).toMatch(
      /npm publish --access public --tag ["']\${{\s*inputs\.npm_tag\s*}}["']/
    )
  })

  it('refuses existing versions before publishing', () => {
    const publishJob = workflow.jobs.publish
    const refuseStep = publishJob.steps.find(
      (step) =>
        step.name === 'Refuse an existing version' ||
        (typeof step.run === 'string' && step.run.includes('npm view'))
    )
    expect(refuseStep).toBeDefined()
    expect(refuseStep.workingDirectory ?? refuseStep['working-directory']).toBe('packages/orca-cli')
    expect(refuseStep.run).toContain('npm view')
    expect(refuseStep.run).toContain('@karlorz/orca-cli@$version')
    expect(refuseStep.run).toContain('exit 1')
  })
})
