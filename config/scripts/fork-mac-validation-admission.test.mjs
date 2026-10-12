import { describe, expect, it } from 'vitest'
import { admitValidation } from './fork-mac-validation-admission.mjs'
import { templateProvenance, verifyTemplateProvenance } from './fork-mac-template-provenance.mjs'

const source = 'a'.repeat(40)
const workflow = 'b'.repeat(40)
const env = {
  GITHUB_REPOSITORY: 'karlorz/orca',
  GITHUB_REPOSITORY_ID: '123',
  GITHUB_EVENT_NAME: 'workflow_dispatch',
  GITHUB_WORKFLOW_SHA: workflow,
  GITHUB_WORKFLOW_REF:
    'karlorz/orca/.github/workflows/fork-mac-validation.yml@refs/heads/ci/reviewed',
  REVIEWED_WORKFLOW_SHA: workflow,
  SOURCE_SHA: source,
  SOURCE_PR: '25',
  SOURCE_BRANCH: 'ci/validation',
  BUILD_LABEL: 'v1.4.224-3'
}
const repo = { full_name: 'karlorz/orca', id: 123, owner: { login: 'karlorz' } }
const pr = {
  number: 25,
  state: 'open',
  base: { ref: 'fork-main', repo },
  head: { ref: env.SOURCE_BRANCH, sha: source, repo }
}
function api(overrides = {}) {
  const responses = {
    'repos/karlorz/orca': repo,
    'repos/karlorz/orca/branches/ci%2Freviewed': { name: 'ci/reviewed', commit: { sha: workflow } },
    'repos/karlorz/orca/branches/ci%2Fvalidation': {
      name: env.SOURCE_BRANCH,
      commit: { sha: source }
    },
    'repos/karlorz/orca/pulls/25': pr,
    'repos/karlorz/orca/branches/fork-main': { name: 'fork-main', commit: { sha: source } },
    ...overrides
  }
  return async (endpoint) => {
    if (!responses[endpoint]) {
      throw new Error('Unexpected API endpoint')
    }
    return responses[endpoint]
  }
}

describe('manual exact-head admission', () => {
  it('resolves a reviewed same-repository PR with separate source/workflow revisions', async () => {
    const result = await admitValidation(env, api())
    expect(result.sourceSha).toBe(source)
    expect(result.workflowSha).toBe(workflow)
  })
  it('supports exact post-merge fork-main without relying on a closed PR', async () => {
    expect(
      await admitValidation({ ...env, SOURCE_PR: '0', SOURCE_BRANCH: 'fork-main' }, api())
    ).toMatchObject({ sourceSha: source, pr: '0' })
  })
  it.each([
    ['GITHUB_REPOSITORY', 'attacker/orca'],
    ['GITHUB_EVENT_NAME', 'pull_request_target'],
    ['SOURCE_SHA', source.slice(0, 7)],
    ['SOURCE_SHA', `${source}\n`],
    ['SOURCE_SHA', 'A'.repeat(40)],
    ['REVIEWED_WORKFLOW_SHA', source],
    ['GITHUB_WORKFLOW_SHA', ''],
    [
      'GITHUB_WORKFLOW_REF',
      'other/orca/.github/workflows/fork-mac-validation.yml@refs/heads/ci/reviewed'
    ],
    [
      'GITHUB_WORKFLOW_REF',
      'karlorz/orca/.github/workflows/fork-mac-validation.yml@refs/tags/v1.4.224-3'
    ],
    ['SOURCE_BRANCH', 'refs/heads/ci/validation'],
    ['SOURCE_BRANCH', 'ci/../main'],
    ['SOURCE_BRANCH', 'ci/bad.lock'],
    ['SOURCE_BRANCH', 'main'],
    ['SOURCE_BRANCH', 'fork-main'],
    ['SOURCE_PR', '0'],
    ['SOURCE_PR', '-1'],
    ['SOURCE_PR', '1;echo'],
    ['BUILD_LABEL', 'v1.4.224'],
    ['BUILD_LABEL', 'v1.4.224-3\n'],
    ['GITHUB_REPOSITORY_ID', '']
  ])('rejects unsupported %s input %s before any API call', async (key, value) => {
    let calls = 0
    await expect(
      admitValidation({ ...env, [key]: value }, async () => {
        calls++
        return repo
      })
    ).rejects.toThrow()
    expect(calls).toBe(0)
  })
  it.each([
    ['state', 'closed'],
    ['number', 26],
    ['base', { ...pr.base, ref: 'main' }],
    ['base', { ...pr.base, repo: { ...repo, id: 456 } }],
    ['head', { ...pr.head, repo: { ...repo, full_name: 'attacker/orca' } }],
    ['head', { ...pr.head, repo: { ...repo, owner: { login: 'attacker' } } }],
    ['head', { ...pr.head, ref: 'other' }],
    ['head', { ...pr.head, sha: workflow }],
    ['head', { ...pr.head, repo: null }]
  ])('rejects live PR %s mismatch', async (key, value) => {
    await expect(
      admitValidation(env, api({ 'repos/karlorz/orca/pulls/25': { ...pr, [key]: value } }))
    ).rejects.toThrow()
  })
  it('rechecks changed source and trusted workflow branches on every admission', async () => {
    await admitValidation(env, api())
    for (const branch of ['ci%2Fvalidation', 'ci%2Freviewed']) {
      const name = decodeURIComponent(branch)
      await expect(
        admitValidation(
          env,
          api({
            [`repos/karlorz/orca/branches/${branch}`]: {
              name,
              commit: { sha: 'c'.repeat(40) }
            }
          })
        )
      ).rejects.toThrow(/changed/)
    }
  })
  it('fails closed on API errors and repository identity changes', async () => {
    await expect(
      admitValidation(env, async () => {
        throw new Error('API unavailable')
      })
    ).rejects.toThrow()
    await expect(
      admitValidation(env, api({ 'repos/karlorz/orca': { ...repo, id: 456 } }))
    ).rejects.toThrow()
  })
})

describe('qualified template provenance', () => {
  const runEnv = { ...env, GITHUB_RUN_ID: '999', GITHUB_RUN_ATTEMPT: '1' }
  const manifest = Buffer.from('fixture manifest')
  it('binds source, repository, run, attempt, and manifest digest', () => {
    const expected = templateProvenance(runEnv, source, manifest)
    expect(expected.manifestSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(() => verifyTemplateProvenance(expected, expected)).not.toThrow()
    for (const key of Object.keys(expected)) {
      expect(() => verifyTemplateProvenance({ ...expected, [key]: 'stale' }, expected)).toThrow()
    }
    expect(() =>
      verifyTemplateProvenance(expected, templateProvenance(runEnv, source, Buffer.from('changed')))
    ).toThrow(/digest/)
  })
  it('rejects source checkout drift, foreign repository, or missing run identity', () => {
    expect(() => templateProvenance(runEnv, workflow, manifest)).toThrow()
    expect(() =>
      templateProvenance({ ...runEnv, GITHUB_REPOSITORY: 'attacker/orca' }, source, manifest)
    ).toThrow()
    expect(() => templateProvenance({ ...runEnv, GITHUB_RUN_ID: '' }, source, manifest)).toThrow()
  })
})
