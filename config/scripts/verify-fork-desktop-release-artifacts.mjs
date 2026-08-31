import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parse } from 'yaml'

export const REQUIRED_FORK_DESKTOP_ARCHIVES = Object.freeze([
  'orca-macos-x64.dmg',
  'orca-macos-arm64.dmg',
  'orca-macos-x64.zip',
  'orca-macos-arm64.zip'
])

export const UPDATE_MANIFEST_FILENAME = 'latest-mac.yml'

export function extractManifestRelativeAssetNames(manifestContent) {
  if (typeof manifestContent !== 'string') {
    throw new Error('Update manifest content must be a string')
  }

  let parsed
  try {
    parsed = parse(manifestContent, { maxAliasCount: 0 })
  } catch (error) {
    throw new Error(
      `Failed to parse update manifest YAML: ${error instanceof Error ? error.message : String(error)}`
    )
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Update manifest YAML root must be an object')
  }

  const referencedNames = new Set()

  const record = parsed

  const checkPathValue = (val, fieldLabel) => {
    if (typeof val !== 'string' || val.trim().length === 0) {
      throw new Error(`Update manifest ${fieldLabel} must be a non-empty string`)
    }
    const trimmed = val.trim()
    if (/^[a-z]+:\/\//i.test(trimmed)) {
      try {
        const parsedUrl = new URL(trimmed)
        const name = parsedUrl.pathname.split('/').findLast(Boolean)
        if (!name) {
          throw new Error(`Update manifest ${fieldLabel} URL has no filename: ${trimmed}`)
        }
        referencedNames.add(name)
      } catch (err) {
        throw new Error(
          `Invalid URL in update manifest ${fieldLabel}: ${trimmed} (${err instanceof Error ? err.message : String(err)})`
        )
      }
    } else {
      if (isAbsolute(trimmed)) {
        throw new Error(`Update manifest ${fieldLabel} cannot be an absolute path: ${trimmed}`)
      }
      if (trimmed.includes('/') || trimmed.includes('\\')) {
        throw new Error(
          `Update manifest ${fieldLabel} cannot contain directory separators: ${trimmed}`
        )
      }
      referencedNames.add(trimmed)
    }
  }

  if ('path' in record && record.path !== undefined && record.path !== null) {
    checkPathValue(record.path, 'path')
  }

  if ('files' in record) {
    if (!Array.isArray(record.files)) {
      throw new Error('Update manifest files field must be an array')
    }
    for (let index = 0; index < record.files.length; index++) {
      const fileEntry = record.files[index]
      if (!fileEntry || typeof fileEntry !== 'object' || Array.isArray(fileEntry)) {
        throw new Error(`Update manifest files[${index}] must be an object`)
      }
      if ('url' in fileEntry && fileEntry.url !== undefined && fileEntry.url !== null) {
        checkPathValue(fileEntry.url, `files[${index}].url`)
      }
      if ('path' in fileEntry && fileEntry.path !== undefined && fileEntry.path !== null) {
        checkPathValue(fileEntry.path, `files[${index}].path`)
      }
    }
  }

  if (referencedNames.size === 0) {
    throw new Error('Update manifest references zero asset files')
  }

  return [...referencedNames].sort()
}

export function verifyForkDesktopReleaseArtifacts(directoryPath) {
  if (!directoryPath || typeof directoryPath !== 'string') {
    throw new Error('Directory path must be provided')
  }

  const absDir = resolve(directoryPath)
  if (!existsSync(absDir)) {
    throw new Error(`Artifact directory does not exist: ${absDir}`)
  }
  const stat = lstatSync(absDir)
  if (!stat.isDirectory()) {
    throw new Error(`Artifact directory path is not a directory: ${absDir}`)
  }

  const manifestPath = join(absDir, UPDATE_MANIFEST_FILENAME)
  if (!existsSync(manifestPath)) {
    throw new Error(
      `Missing required update manifest ${UPDATE_MANIFEST_FILENAME} in artifact directory: ${absDir}`
    )
  }

  const missingArchives = []
  for (const archiveName of REQUIRED_FORK_DESKTOP_ARCHIVES) {
    const archivePath = join(absDir, archiveName)
    if (!existsSync(archivePath)) {
      missingArchives.push(archiveName)
    }
  }

  if (missingArchives.length > 0) {
    throw new Error(
      `Artifact directory is missing required release archive(s):\n  ${missingArchives.join('\n  ')}`
    )
  }

  const manifestContent = readFileSync(manifestPath, 'utf8')
  const referencedNames = extractManifestRelativeAssetNames(manifestContent)

  const missingReferenced = []
  for (const name of referencedNames) {
    const assetPath = join(absDir, name)
    if (!existsSync(assetPath)) {
      missingReferenced.push(name)
    }
  }

  if (missingReferenced.length > 0) {
    throw new Error(
      `Update manifest ${UPDATE_MANIFEST_FILENAME} references asset(s) not present in artifact directory:\n  ${missingReferenced.join('\n  ')}`
    )
  }

  const presentFiles = readdirSync(absDir).sort()

  return {
    directory: absDir,
    manifest: UPDATE_MANIFEST_FILENAME,
    requiredArchives: [...REQUIRED_FORK_DESKTOP_ARCHIVES],
    referencedAssets: referencedNames,
    presentFiles
  }
}

function main() {
  const dir = process.argv[2] || 'desktop-artifacts'
  try {
    const result = verifyForkDesktopReleaseArtifacts(dir)
    console.log(
      `Verified ${result.requiredArchives.length} required archives and ${result.referencedAssets.length} manifest-referenced assets in ${result.directory}`
    )
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main()
}
