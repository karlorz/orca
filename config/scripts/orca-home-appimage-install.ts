import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import {
  access,
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rename,
  rm
} from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

async function syncDirectory(directory: string): Promise<void> {
  const file = await open(directory, 'r')
  try {
    await file.sync()
  } finally {
    await file.close()
  }
}

async function atomicWrite(file: string, bytes: string): Promise<void> {
  const temporary = `${file}.${randomUUID()}.tmp`
  const handle = await open(temporary, 'wx', 0o600)
  try {
    await handle.writeFile(bytes)
    await handle.sync()
  } finally {
    await handle.close()
  }
  await rename(temporary, file)
  await syncDirectory(dirname(file))
}

export async function acquireHomeAppImageLock(root: string): Promise<() => Promise<void>> {
  await mkdir(root, { recursive: true, mode: 0o700 })
  const lock = join(root, '.install-lock')
  try {
    await mkdir(lock, { mode: 0o700 })
  } catch {
    throw new Error(
      'Another home updater holds .install-lock; an attended recovery is required after a crash'
    )
  }
  return async () => {
    await rm(lock, { recursive: true })
    await syncDirectory(root)
  }
}

async function writeIdentity(root: string, identity: HomeAppImageIdentity): Promise<void> {
  await atomicWrite(join(root, 'appimage.sha256'), `${identity.sha256}  ${HOME_APPIMAGE_NAME}\n`)
  await atomicWrite(join(root, 'release-tag'), `${identity.tag}\n`)
  await atomicWrite(join(root, 'installed-release.json'), `${JSON.stringify(identity)}\n`)
}

export async function recoverHomeAppImage(
  root: string,
  extract: HomeAppImageExtractor
): Promise<void> {
  const journalFile = join(root, '.install-pending')
  if (
    !(await access(journalFile).then(
      () => true,
      () => false
    ))
  ) {
    return
  }
  const identity = await readHomeImageIdentity(journalFile)
  const value: unknown = JSON.parse(await readFile(journalFile, 'utf8'))
  if (
    !identity ||
    typeof value !== 'object' ||
    value === null ||
    !('stage' in value) ||
    typeof value.stage !== 'string' ||
    dirname(resolve(value.stage)) !== resolve(root) ||
    !value.stage.startsWith(join(root, '.download.'))
  ) {
    throw new Error('Interrupted install identity is unverifiable; select a release explicitly')
  }
  const image = join(root, HOME_APPIMAGE_NAME)
  const digest = await homeAppImageDigest(image).catch(() => null)
  if (digest !== identity.sha256) {
    const stageImage = join(value.stage, HOME_APPIMAGE_NAME)
    if ((await verifyHomeAppImage(value.stage, extract)) !== identity.sha256) {
      throw new Error('Interrupted install staging checksum disagrees with its journal')
    }
    await rename(stageImage, image)
    await syncDirectory(root)
  } else {
    await verifyHomeAppImageMarker(image, extract)
  }
  await writeIdentity(root, identity)
  await rm(journalFile)
  await syncDirectory(root)
  await rm(value.stage, { recursive: true, force: true })
}

export async function verifyInstalledHomeAppImage(
  root: string,
  extract: HomeAppImageExtractor
): Promise<HomeAppImageIdentity> {
  const image = join(root, HOME_APPIMAGE_NAME)
  const digest = await homeAppImageDigest(image)
  const recorded = await readHomeImageIdentity(join(root, 'installed-release.json'))
  const pin = (await readFile(join(root, 'release-tag'), 'utf8').catch(() => '')).trim()
  const savedDigest = await readFile(join(root, 'appimage.sha256'), 'utf8').then(
    parseHomeAppImageChecksum,
    () => null
  )
  if (
    savedDigest !== digest ||
    !validHomeReleaseTag(pin) ||
    (recorded && (recorded.tag !== pin || recorded.sha256 !== digest))
  ) {
    throw new Error('Saved image and release pin disagree')
  }
  const stat = await lstat(image)
  if (!(stat.mode & 0o111)) {
    throw new Error('Installed AppImage is not executable')
  }
  await verifyHomeAppImageMarker(image, extract)
  return { tag: pin, sha256: digest }
}

export async function reconcileHomeAppImage(
  root: string,
  runningTag: string | undefined,
  extract: HomeAppImageExtractor
): Promise<HomeAppImageIdentity> {
  await recoverHomeAppImage(root, extract)
  const image = join(root, HOME_APPIMAGE_NAME)
  const digest = await homeAppImageDigest(image)
  const stat = await lstat(image)
  if (!(stat.mode & 0o111)) {
    throw new Error('Installed AppImage is not executable')
  }
  const recorded = await readHomeImageIdentity(join(root, 'installed-release.json'))
  let identity: HomeAppImageIdentity
  if (recorded?.sha256 === digest) {
    identity = recorded
    await verifyHomeAppImageMarker(image, extract)
  } else if (recorded) {
    throw new Error(
      'Installed image differs from its verified release identity; repair the exact pin'
    )
  } else {
    if (
      await access(join(root, 'installed-release.json')).then(
        () => true,
        () => false
      )
    ) {
      throw new Error('Saved release identity is corrupt; attended repair required')
    }
    identity = await verifyInstalledHomeAppImage(root, extract)
    // Legacy installs can be adopted only when the running build agrees with their saved pin.
    if (runningTag && identity.tag !== runningTag) {
      throw new Error('Legacy image pin disagrees with the running build; attended repair required')
    }
  }
  if (runningTag && compareHomeTags(identity.tag, runningTag) < 0) {
    throw new Error('Installed image is older than the running build; attended repair required')
  }
  await writeIdentity(root, identity)
  return identity
}

export async function commitHomeAppImage(
  root: string,
  stage: string,
  tag: string,
  extract: HomeAppImageExtractor
): Promise<HomeAppImageIdentity> {
  if (!validHomeReleaseTag(tag) || dirname(resolve(stage)) !== resolve(root)) {
    throw new Error('Expected a fork tag and staging directory beside the installed image')
  }
  await recoverHomeAppImage(root, extract)
  const identity = { tag, sha256: await verifyHomeAppImage(stage, extract) }
  const current = await verifyInstalledHomeAppImage(root, extract).catch(() => null)
  const recorded = await readHomeImageIdentity(join(root, 'installed-release.json'))
  if (
    (recorded?.tag === tag && recorded.sha256 !== identity.sha256) ||
    (current?.tag === tag && current.sha256 !== identity.sha256)
  ) {
    throw new Error('Published release tag bytes changed; select a new fork suffix')
  }
  if (current && current.sha256 !== identity.sha256) {
    const temporary = join(root, `.${HOME_APPIMAGE_NAME}.previous.${randomUUID()}`)
    await copyFile(join(root, HOME_APPIMAGE_NAME), temporary)
    const handle = await open(temporary, 'r')
    try {
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(temporary, join(root, `${HOME_APPIMAGE_NAME}.previous`))
    await atomicWrite(join(root, 'release-tag.previous'), `${current.tag}\n`)
    await atomicWrite(
      join(root, 'appimage.sha256.previous'),
      `${current.sha256}  ${HOME_APPIMAGE_NAME}\n`
    )
  }
  const stagedImage = await open(join(stage, HOME_APPIMAGE_NAME), 'r')
  try {
    await stagedImage.sync()
  } finally {
    await stagedImage.close()
  }
  await atomicWrite(join(root, '.install-pending'), `${JSON.stringify({ ...identity, stage })}\n`)
  await rename(join(stage, HOME_APPIMAGE_NAME), join(root, HOME_APPIMAGE_NAME))
  await syncDirectory(root)
  await writeIdentity(root, identity)
  await rm(join(root, '.install-pending'))
  await syncDirectory(root)
  return identity
}

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
