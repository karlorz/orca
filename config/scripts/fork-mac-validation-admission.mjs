import { execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const REPOSITORY = 'karlorz/orca'
const SHA = /^[0-9a-f]{40}$/
const BRANCH = /^(?!.*(?:\.\.|@\{|\/\/))[A-Za-z0-9][A-Za-z0-9._/-]*$/

export function validationInputs(env) {
  for (const key of [
    'SOURCE_SHA',
    'REVIEWED_WORKFLOW_SHA',
    'GITHUB_WORKFLOW_SHA',
    'SOURCE_PR',
    'SOURCE_BRANCH',
    'BUILD_LABEL'
  ]) {
    if (typeof env[key] !== 'string' || /\s/.test(env[key])) {
      throw new Error('Exact input format required')
    }
  }
  if (env.GITHUB_REPOSITORY !== REPOSITORY || env.GITHUB_EVENT_NAME !== 'workflow_dispatch') {
    throw new Error('Validation requires an attended dispatch in karlorz/orca')
  }
  for (const value of [env.SOURCE_SHA, env.REVIEWED_WORKFLOW_SHA, env.GITHUB_WORKFLOW_SHA]) {
    if (!SHA.test(value ?? '')) {
      throw new Error('A full lowercase 40-character SHA is required')
    }
  }
  if (env.REVIEWED_WORKFLOW_SHA !== env.GITHUB_WORKFLOW_SHA) {
    throw new Error('Trusted workflow revision differs from reviewed workflow SHA')
  }
  const prefix = `${REPOSITORY}/.github/workflows/fork-mac-validation.yml@refs/heads/`
  if (!env.GITHUB_WORKFLOW_REF?.startsWith(prefix)) {
    throw new Error('Unsupported trusted workflow reference')
  }
  const workflowBranch = env.GITHUB_WORKFLOW_REF.slice(prefix.length)
  const sourceBranch = env.SOURCE_BRANCH ?? ''
  for (const branch of [workflowBranch, sourceBranch]) {
    if (
      !BRANCH.test(branch) ||
      branch.startsWith('refs/') ||
      branch.endsWith('/') ||
      branch.endsWith('.') ||
      branch.endsWith('.lock')
    ) {
      throw new Error('Unsupported branch reference')
    }
  }
  if (!/^v\d+\.\d+\.\d+-\d+$/.test(env.BUILD_LABEL ?? '')) {
    throw new Error('Strict fork build label required; label is local metadata only')
  }
  const pr = env.SOURCE_PR ?? ''
  if (!/^(0|[1-9]\d*)$/.test(pr) || !Number.isSafeInteger(Number(pr))) {
    throw new Error('Source PR must be a decimal number or 0 for merged fork-main')
  }
  if ((pr === '0') !== (sourceBranch === 'fork-main') || sourceBranch === 'main') {
    throw new Error('Source must be a same-repository PR branch or exact merged fork-main')
  }
  if (!/^[1-9]\d*$/.test(env.GITHUB_REPOSITORY_ID ?? '')) {
    throw new Error('Repository identity missing')
  }
  return {
    sourceSha: env.SOURCE_SHA,
    workflowSha: env.REVIEWED_WORKFLOW_SHA,
    workflowBranch,
    sourceBranch,
    pr,
    repositoryId: Number(env.GITHUB_REPOSITORY_ID)
  }
}

export async function admitValidation(env, readApi) {
  const input = validationInputs(env)
  const repo = await readApi(`repos/${REPOSITORY}`)
  const trustedRepo = (candidate) =>
    candidate?.full_name === REPOSITORY &&
    candidate?.id === input.repositoryId &&
    candidate?.owner?.login === 'karlorz'
  if (!trustedRepo(repo)) {
    throw new Error('Repository owner or identity mismatch')
  }
  const host = await readApi(
    `repos/${REPOSITORY}/branches/${encodeURIComponent(input.workflowBranch)}`
  )
  if (host.name !== input.workflowBranch || host.commit?.sha !== input.workflowSha) {
    throw new Error('Trusted workflow branch changed since review')
  }
  if (input.pr !== '0') {
    const pr = await readApi(`repos/${REPOSITORY}/pulls/${input.pr}`)
    if (
      pr.state !== 'open' ||
      pr.number !== Number(input.pr) ||
      pr.base?.ref !== 'fork-main' ||
      !trustedRepo(pr.base?.repo) ||
      !trustedRepo(pr.head?.repo) ||
      pr.head?.ref !== input.sourceBranch ||
      pr.head?.sha !== input.sourceSha
    ) {
      throw new Error('Source PR repository, base, branch, state, or reviewed head mismatch')
    }
  }
  const head = await readApi(
    `repos/${REPOSITORY}/branches/${encodeURIComponent(input.sourceBranch)}`
  )
  if (head.name !== input.sourceBranch || head.commit?.sha !== input.sourceSha) {
    throw new Error('Source branch head changed since review')
  }
  return input
}

async function main() {
  const trustedRoot = resolve(import.meta.dirname, '../..')
  const actual = execFileSync('git', ['-C', trustedRoot, 'rev-parse', 'HEAD'], {
    encoding: 'utf8'
  }).trim()
  if (actual !== process.env.REVIEWED_WORKFLOW_SHA) {
    throw new Error('Trusted admission checkout mismatch')
  }
  const input = await admitValidation(process.env, async (endpoint) =>
    JSON.parse(execFileSync('gh', ['api', endpoint], { encoding: 'utf8', maxBuffer: 1024 * 1024 }))
  )
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `source_sha=${input.sourceSha}\n`)
  }
  const evidence = `Repository: ${REPOSITORY}\nWorkflow SHA: ${input.workflowSha}\nSource SHA: ${input.sourceSha}\nSource branch: ${input.sourceBranch}\nSource PR: ${input.pr}\n`
  console.log(evidence)
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `### Exact-head admission\n\n${evidence}\nLive admission checks require separate human approval of both reviewed revisions.\n`
    )
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main()
}
