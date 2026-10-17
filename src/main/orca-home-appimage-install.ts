import { randomUUID } from 'node:crypto'
import { access, copyFile, lstat, mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import {
  HOME_APPIMAGE_NAME,
  compareHomeTags,
  homeAppImageDigest,
  parseHomeAppImageChecksum,
  readHomeImageIdentity,
  validHomeReleaseTag,
  verifyHomeAppImage,
  verifyHomeAppImageMarker,
  type HomeAppImageExtractor,
  type HomeAppImageIdentity
} from './orca-home-appimage-verification.ts'

export {
  HOME_APPIMAGE_NAME,
  compareHomeTags,
  homeAppImageDigest,
  parseHomeAppImageChecksum,
  readHomeImageIdentity,
  validHomeReleaseTag,
  verifyHomeAppImage,
  verifyHomeAppImageMarker,
  type HomeAppImageExtractor,
  type HomeAppImageIdentity
} from './orca-home-appimage-verification.ts'

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
  const pin = (await readFile(join(root, 'release-tag'), 'utf8').catch(() => '')).trim()
  const savedDigest = await readFile(join(root, 'appimage.sha256'), 'utf8').then(
    parseHomeAppImageChecksum,
    () => null
  )
  const recorded = await readHomeImageIdentity(join(root, 'installed-release.json'))
  if (
    !recorded ||
    savedDigest !== digest ||
    !validHomeReleaseTag(pin) ||
    recorded.sha256 !== digest ||
    recorded.tag !== pin
  ) {
    throw new Error('Saved image and release pin disagree')
  }
  const stat = await lstat(image)
  if (!(stat.mode & 0o111)) {
    throw new Error('Installed AppImage is not executable')
  }
  await verifyHomeAppImageMarker(image, extract)
  return recorded
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
