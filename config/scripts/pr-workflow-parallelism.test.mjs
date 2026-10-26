import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'

const workflow = parse(readFileSync('.github/workflows/pr.yml', 'utf8'))
const unitTestWorkflow = parse(readFileSync('.github/workflows/unit-tests.yml', 'utf8'))
const evidenceWorkflow = parse(
  readFileSync('.github/workflows/unit-selection-evidence.yml', 'utf8')
)

describe('PR workflow parallelism', () => {
  it('routes the fork to available runners while retaining upstream runners', () => {
    for (const [expression, hosted, upstream] of [
      [workflow.jobs.code_paths['runs-on'], 'ubuntu-24.04', 'blacksmith-2vcpu-ubuntu-2404'],
      [workflow.jobs.preflight['runs-on'], 'ubuntu-24.04', 'blacksmith-8vcpu-ubuntu-2404'],
      [workflow.jobs.test.with.runner, 'ubuntu-24.04', 'blacksmith-4vcpu-ubuntu-2404'],
      [
        workflow.jobs.dependency_isolation['runs-on'],
        'ubuntu-24.04',
        'blacksmith-4vcpu-ubuntu-2404'
      ],
      [workflow.jobs.verify['runs-on'], 'ubuntu-22.04', 'blacksmith-2vcpu-ubuntu-2204']
    ]) {
      for (const repository of ['karlorz/orca', 'stablyai/orca']) {
        expect(runInNewContext(expression.slice(3, -2), { github: { repository } })).toBe(
          repository === 'karlorz/orca' ? hosted : upstream
        )
      }
    }
    expect(workflow.jobs.verify['continue-on-error']).toBeUndefined()
    expect(workflow.jobs.verify.steps.every((step) => !step['continue-on-error'])).toBe(true)
  })

  it('enforces import boundaries in the required static-analysis checks', () => {
    const guard = workflow.jobs.preflight.steps.find((step) =>
      step.run?.includes('bun config/scripts/check-import-boundaries.mjs')
    )
    expect(guard?.if).toBe('!cancelled()')
    expect(guard?.env.PREFLIGHT_PHASE_SELECTED).toBe(
      "${{ needs.code_paths.outputs.static_analysis == 'true' }}"
    )
    expect(guard?.background).toBe(true)
    const typecheckIndex = workflow.jobs.preflight.steps.findIndex(
      (step) => step.wait === 'typecheck'
    )
    const waitIndex = workflow.jobs.preflight.steps.findIndex((step) => step.wait === guard.id)
    expect(waitIndex).toBeGreaterThan(typecheckIndex)
    expect(guard?.['continue-on-error']).toBeUndefined()
  })

  it('keeps advisory unit-selection evidence off the gate', () => {
    // Keep advisory continue-on-error work off unit-tests.yml’s critical path: caller needs:test otherwise waits ~36s beyond last shard.
    const evidence = workflow.jobs.unit_selection_evidence
    expect(evidence.uses).toBe('./.github/workflows/unit-selection-evidence.yml')
    expect(evidence.needs).toEqual(['test'])
    for (const [result, cancelled, expected] of [
      ['success', false, true],
      ['failure', false, true],
      ['skipped', false, false],
      ['cancelled', false, false],
      ['success', true, false],
      ['failure', true, false]
    ]) {
      expect(
        runInNewContext(evidence.if.slice(3, -2), {
          cancelled: () => cancelled,
          needs: { test: { result } }
        })
      ).toBe(expected)
    }
    expect(workflow.jobs.verify.needs).not.toContain('unit_selection_evidence')
    expect(unitTestWorkflow.jobs.selection_evidence).toBeUndefined()
    const job = evidenceWorkflow.jobs.selection_evidence
    expect(job['continue-on-error']).toBe(true)
  })

  it('runs the advisory CLI without an action credential and preserves failures', async () => {
    const steps = evidenceWorkflow.jobs.selection_evidence.steps
    expect(steps.some((step) => step.uses?.startsWith('actions/setup-node@'))).toBe(false)
    const comparison = steps.find((step) => step.name === 'Compare selection with full results')
    expect(comparison.uses).toBe('actions/github-script@v8')
    expect(comparison.with['github-token']).toBe('unused')
    const env = { 'INPUT_GITHUB-TOKEN': 'test-token', GITHUB_STEP_SUMMARY: '/tmp/summary' }
    const failure = new Error('comparison failed')
    const result = runInNewContext(`(async () => { ${comparison.with.script} })()`, {
      process: { env, execPath: '/bundled/node24' },
      exec: {
        exec: async (command, args, options) => {
          expect(command).toBe('/bundled/node24')
          expect(args).toEqual(['config/scripts/ci-unit-selection-review.mjs', 'unit-evidence'])
          expect(options.env).toEqual({ GITHUB_STEP_SUMMARY: '/tmp/summary' })
          throw failure
        }
      }
    })
    await expect(result).rejects.toBe(failure)
    expect(env['INPUT_GITHUB-TOKEN']).toBe('test-token')
  })
})

it('keeps the costly layout-owner experiment manual and limits it to one active suite', () => {
  const experiment = parse(readFileSync('.github/workflows/layout-owner-e2e.yml', 'utf8'))
  expect(Object.keys(experiment.on)).toEqual(['workflow_dispatch'])
  expect(experiment.concurrency).toEqual({
    group: 'layout-owner-e2e',
    'cancel-in-progress': false
  })
  for (const job of Object.values(workflow.jobs)) {
    expect(job.with?.layout_owner).toBeUndefined()
  }
})
