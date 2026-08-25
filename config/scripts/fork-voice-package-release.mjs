import { readFileSync, writeFileSync, existsSync, rmSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  generateSha256Sums,
  buildReleaseMetadata,
  buildTestSummaryMarkdown
} from './fork-voice-release-metadata.mjs'

export async function packageDraftRelease({
  artifactsDir,
  outputDir,
  sourceSha,
  tag,
  runId,
  runNumber,
  runAttempt,
  repository,
  verificationCommands = []
}) {
  if (!existsSync(artifactsDir)) {
    throw new Error(`Artifacts directory not found: ${artifactsDir}`)
  }
  if (existsSync(outputDir)) {
    rmSync(outputDir, { recursive: true, force: true })
  }
  mkdirSync(outputDir, { recursive: true })

  const packageJson = JSON.parse(readFileSync('package.json', 'utf8'))
  const mobileAppJson = JSON.parse(readFileSync('mobile/app.json', 'utf8'))

  const rootVersion = packageJson.version
  const mobileVersion = mobileAppJson.expo?.version
  const mobileVersionCode = mobileAppJson.expo?.android?.versionCode

  if (
    typeof rootVersion !== 'string' ||
    rootVersion.trim().length === 0 ||
    typeof mobileVersion !== 'string' ||
    mobileVersion.trim().length === 0 ||
    typeof mobileVersionCode !== 'number' ||
    !Number.isInteger(mobileVersionCode) ||
    mobileVersionCode <= 0
  ) {
    throw new Error(
      `Failed to derive valid versions from project manifests: root=${rootVersion}, mobile=${mobileVersion}, versionCode=${mobileVersionCode}`
    )
  }

  let androidMetadata = {}
  const androidMetaPath = join(artifactsDir, 'android-metadata.json')
  if (existsSync(androidMetaPath)) {
    androidMetadata = JSON.parse(readFileSync(androidMetaPath, 'utf8'))
  }

  const filesMap = {}
  const copiedArtifacts = []

  const artifactNames = ['orca-mobile.apk']

  for (const name of artifactNames) {
    const src = join(artifactsDir, name)
    if (!existsSync(src)) {
      throw new Error(`Required release artifact not found: ${src}`)
    }
    const content = readFileSync(src)
    writeFileSync(join(outputDir, name), content)
    filesMap[name] = content
    copiedArtifacts.push(name)
  }

  const sha256sums = generateSha256Sums(filesMap)
  writeFileSync(join(outputDir, 'SHA256SUMS.txt'), sha256sums, 'utf8')

  const metadata = buildReleaseMetadata({
    sourceSha,
    tag,
    runId,
    runNumber,
    runAttempt,
    repository,
    rootVersion,
    mobileVersion,
    mobileVersionCode,
    androidMetadata,
    artifacts: copiedArtifacts
  })
  writeFileSync(join(outputDir, 'BUILD-METADATA.json'), JSON.stringify(metadata, null, 2), 'utf8')

  const testSummary = buildTestSummaryMarkdown({
    verificationPassed: true,
    commands: verificationCommands
  })
  writeFileSync(join(outputDir, 'TEST-SUMMARY.md'), testSummary, 'utf8')

  return {
    artifacts: copiedArtifacts,
    sha256sums,
    metadata,
    testSummary
  }
}
