import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export function templateProvenance(env, checkoutSha, manifest) {
  if (!/^[0-9a-f]{40}$/.test(env.SOURCE_SHA ?? '') || checkoutSha !== env.SOURCE_SHA) {
    throw new Error('Template checkout differs from admitted source SHA')
  }
  if (
    env.GITHUB_REPOSITORY !== 'karlorz/orca' ||
    !/^[1-9]\d*$/.test(env.GITHUB_RUN_ID ?? '') ||
    !/^[1-9]\d*$/.test(env.GITHUB_RUN_ATTEMPT ?? '')
  ) {
    throw new Error('Template run identity missing or untrusted')
  }
  return {
    repository: env.GITHUB_REPOSITORY,
    sourceSha: env.SOURCE_SHA,
    runId: env.GITHUB_RUN_ID,
    runAttempt: env.GITHUB_RUN_ATTEMPT,
    manifestSha256: createHash('sha256').update(manifest).digest('hex')
  }
}

export function verifyTemplateProvenance(actual, expected) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error('Template source, same-run attempt, or manifest digest mismatch')
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [mode, filename] = process.argv.slice(2)
  if (!['write', 'verify'].includes(mode) || !filename) {
    throw new Error('Use write|verify <evidence-file>')
  }
  const checkout = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  const expected = templateProvenance(
    process.env,
    checkout,
    readFileSync(join(dirname(filename), 'orcad-template.json'))
  )
  if (mode === 'write') {
    writeFileSync(filename, `${JSON.stringify(expected)}\n`)
  } else {
    verifyTemplateProvenance(JSON.parse(readFileSync(filename, 'utf8')), expected)
  }
  console.log(`Same-run template verified: ${expected.sourceSha}, ${expected.manifestSha256}`)
}
