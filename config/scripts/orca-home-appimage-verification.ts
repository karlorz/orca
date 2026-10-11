import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { chmod, lstat, mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'

export type HomeAppImageExtractor = (image: string, cwd: string) => Promise<void>
export type HomeAppImageIdentity = { tag: string; sha256: string }
export const HOME_APPIMAGE_NAME = 'orca-linux.AppImage'

export function validHomeReleaseTag(tag: unknown): tag is string {
  return typeof tag === 'string' && /^v\d+\.\d+\.\d+-\d+$/.test(tag)
}

export function compareHomeTags(left: string, right: string): number {
  if (!validHomeReleaseTag(left) || !validHomeReleaseTag(right)) {
    throw new Error('Expected a fork desktop release tag')
  }
  const a = left.slice(1).split(/[.-]/).map(Number)
  const b = right.slice(1).split(/[.-]/).map(Number)
  const index = a.findIndex((part, i) => part !== b[i])
  return index === -1 ? 0 : a[index] - b[index]
}

export async function homeAppImageDigest(image: string): Promise<string> {
  const stat = await lstat(image)
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error('Expected a regular AppImage file')
  }
  const hash = createHash('sha256')
  for await (const bytes of createReadStream(image)) {
    hash.update(bytes)
  }
  return hash.digest('hex')
}

export function parseHomeAppImageChecksum(text: string): string {
  const matches = text.split(/\r?\n/).flatMap((line) => {
    const match = /^([a-fA-F0-9]{64})\s+\*?orca-linux\.AppImage\s*$/.exec(line)
    return match ? [match[1].toLowerCase()] : []
  })
  if (matches.length !== 1) {
    throw new Error('Missing or ambiguous AppImage checksum')
  }
  return matches[0]
}

export async function verifyHomeAppImageMarker(
  image: string,
  extract: HomeAppImageExtractor
): Promise<void> {
  const directory = await mkdtemp(join((await import('node:path')).dirname(image), '.verify.'))
  try {
    await extract(image, directory)
    const marker = join(directory, 'squashfs-root', 'resources', 'package-type')
    const template = join(
      directory,
      'squashfs-root',
      'resources',
      'orcad-template',
      'orcad-template.json'
    )
    const templateStat = await lstat(template).catch(() => null)
    if (!templateStat?.isFile() || templateStat.isSymbolicLink() || !templateStat.size) {
      throw new Error('AppImage is missing the required orcad-template manifest')
    }
    JSON.parse(await readFile(template, 'utf8'))
    const stat = await lstat(marker)
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      (await readFile(marker, 'utf8')).trim() !== 'AppImage'
    ) {
      throw new Error('Expected an AppImage package-type marker')
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

export async function verifyHomeAppImage(
  stage: string,
  extract: HomeAppImageExtractor
): Promise<string> {
  const image = join(stage, HOME_APPIMAGE_NAME)
  const expected = parseHomeAppImageChecksum(await readFile(join(stage, 'SHA256SUMS.txt'), 'utf8'))
  if ((await homeAppImageDigest(image)) !== expected) {
    throw new Error('AppImage checksum mismatch')
  }
  await chmod(image, 0o755)
  await verifyHomeAppImageMarker(image, extract)
  return expected
}

export async function readHomeImageIdentity(file: string): Promise<HomeAppImageIdentity | null> {
  try {
    const value: unknown = JSON.parse(await readFile(file, 'utf8'))
    if (
      typeof value === 'object' &&
      value !== null &&
      'tag' in value &&
      'sha256' in value &&
      validHomeReleaseTag(value.tag) &&
      typeof value.sha256 === 'string' &&
      /^[a-f0-9]{64}$/.test(value.sha256)
    ) {
      return { tag: value.tag, sha256: value.sha256 }
    }
  } catch {}
  return null
}
