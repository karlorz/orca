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

export const PLATFORM_MANIFESTS = Object.freeze({
  mac: 'latest-mac.yml',
  linux: 'latest-linux.yml',
  windows: 'latest.yml'
})

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

function verifySinglePlatform(absDir, platform, presentFiles) {
  const manifestName = PLATFORM_MANIFESTS[platform]
  if (!manifestName) {
    throw new Error(`Unsupported platform for verification: ${platform}`)
  }

  const manifestPath = join(absDir, manifestName)
  if (!existsSync(manifestPath)) {
    throw new Error(
      `Missing required update manifest ${manifestName} in artifact directory: ${absDir}`
    )
  }

  const missingArchives = []

  if (platform === 'mac') {
    for (const archiveName of REQUIRED_FORK_DESKTOP_ARCHIVES) {
      if (!existsSync(join(absDir, archiveName))) {
        missingArchives.push(archiveName)
      }
    }
  } else if (platform === 'linux') {
    const hasAppImage = presentFiles.some((f) => f.endsWith('.AppImage'))
    const hasDeb = presentFiles.some((f) => f.endsWith('.deb'))
    const hasRpm = presentFiles.some((f) => f.endsWith('.rpm'))
    if (!hasAppImage) {
      missingArchives.push('*.AppImage')
    }
    if (!hasDeb) {
      missingArchives.push('*.deb')
    }
    if (!hasRpm) {
      missingArchives.push('*.rpm')
    }
  } else if (platform === 'windows') {
    if (!existsSync(join(absDir, 'orca-windows-setup.exe'))) {
      missingArchives.push('orca-windows-setup.exe')
    }
    if (!existsSync(join(absDir, 'orca-windows-setup.exe.blockmap'))) {
      missingArchives.push('orca-windows-setup.exe.blockmap')
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
    if (!existsSync(join(absDir, name))) {
      missingReferenced.push(name)
    }
  }

  if (missingReferenced.length > 0) {
    throw new Error(
      `Update manifest ${manifestName} references asset(s) not present in artifact directory:\n  ${missingReferenced.join('\n  ')}`
    )
  }

  return {
    manifest: manifestName,
    referencedAssets: referencedNames
  }
}

export function verifyForkDesktopReleaseArtifacts(directoryPath, options = {}) {
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

  const presentFiles = readdirSync(absDir).sort()
  const platformOption = options.platform ?? 'mac'

  if (platformOption === 'all') {
    const platforms = ['mac', 'linux', 'windows']
    const results = {}
    for (const p of platforms) {
      results[p] = verifySinglePlatform(absDir, p, presentFiles)
    }
    return {
      directory: absDir,
      platforms,
      details: results,
      presentFiles
    }
  }

  const single = verifySinglePlatform(absDir, platformOption, presentFiles)
  return {
    directory: absDir,
    manifest: single.manifest,
    requiredArchives: platformOption === 'mac' ? [...REQUIRED_FORK_DESKTOP_ARCHIVES] : [],
    referencedAssets: single.referencedAssets,
    presentFiles
  }
}

function parseCliArgs(args) {
  let dir = 'desktop-artifacts'
  let platform = 'mac'
  for (const arg of args) {
    if (arg.startsWith('--platform=')) {
      platform = arg.slice('--platform='.length).trim()
    } else if (!arg.startsWith('--')) {
      dir = arg
    }
  }
  return { dir, platform }
}

function main() {
  const { dir, platform } = parseCliArgs(process.argv.slice(2))
  try {
    const result = verifyForkDesktopReleaseArtifacts(dir, { platform })
    if (result.platforms) {
      console.log(
        `Verified all platform artifacts (${result.platforms.join(', ')}) in ${result.directory}`
      )
    } else {
      console.log(
        `Verified platform '${platform}' with manifest ${result.manifest} and ${result.referencedAssets.length} referenced assets in ${result.directory}`
      )
    }
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main()
}
