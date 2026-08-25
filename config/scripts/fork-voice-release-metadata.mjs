import { createHash } from 'node:crypto'
import { basename } from 'node:path'

export function computeSha256(bufferOrString) {
  const hash = createHash('sha256')
  hash.update(bufferOrString)
  return hash.digest('hex')
}

export function generateSha256Sums(filesMap) {
  const entries = Object.entries(filesMap).sort(([a], [b]) => a.localeCompare(b))
  const lines = entries.map(([fileName, content]) => {
    const hash = computeSha256(content)
    return `${hash}  ${basename(fileName)}`
  })
  return `${lines.join('\n')}\n`
}

export function verifyReleaseChecksums(checksumsContent, filesMap) {
  const lines = checksumsContent.trim().split('\n')
  for (const line of lines) {
    const parts = line.trim().split(/\s+/)
    if (parts.length < 2) {
      continue
    }
    const [expectedHash, fileName] = parts
    const content = filesMap[fileName]
    if (!content) {
      throw new Error(`File in checksums list not found in map: ${fileName}`)
    }
    const actualHash = computeSha256(content)
    if (actualHash !== expectedHash) {
      throw new Error(`Hash mismatch for ${fileName}: expected ${expectedHash}, got ${actualHash}`)
    }
  }
  return true
}

export function buildReleaseMetadata({
  sourceSha,
  tag,
  runId,
  runNumber,
  runAttempt,
  repository,
  rootVersion,
  mobileVersion,
  mobileVersionCode,
  macMetadata = {},
  androidMetadata = {},
  artifacts = []
}) {
  return {
    releaseType: 'development-prerelease',
    repository,
    tag,
    sourceSha,
    runId,
    runNumber,
    runAttempt,
    rootVersion,
    mobileVersion,
    mobileVersionCode,
    signingMode: 'ad-hoc/development; not notarized',
    macMetadata,
    androidMetadata,
    artifacts: [...artifacts].sort(),
    createdAt: new Date().toISOString()
  }
}

export function buildTestSummaryMarkdown({ verificationPassed, commands = [] }) {
  return [
    '# Verification Gates Summary',
    '',
    `Status: ${verificationPassed ? 'PASSED' : 'FAILED'}`,
    '',
    '## Verification Steps Executed',
    ...commands.map((cmd) => `- \`${cmd}\``),
    '',
    'All required tests and gates executed on GitHub Actions runner.'
  ].join('\n')
}
