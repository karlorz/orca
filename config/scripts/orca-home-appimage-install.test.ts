import { chmod, mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  acquireHomeAppImageLock,
  commitHomeAppImage,
  reconcileHomeAppImage,
  recoverHomeAppImage,
  verifyHomeAppImage,
  homeAppImageDigest
} from './orca-home-appimage-install'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
const extract = async (_image: string, directory: string): Promise<void> => {
  await mkdir(path.join(directory, 'squashfs-root', 'resources'), { recursive: true })
  await writeFile(path.join(directory, 'squashfs-root', 'resources', 'package-type'), 'AppImage\n')
  const template = path.join(directory, 'squashfs-root', 'resources', 'orcad-template')
  await mkdir(template)
  await writeFile(path.join(template, 'orcad-template.json'), '{}')
}
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'orca-atomic-install-'))
  roots.push(root)
  return root
}
async function stage(root: string, content: string) {
  const directory = await mkdtemp(path.join(root, '.download.'))
  await writeFile(path.join(directory, 'orca-linux.AppImage'), content)
  await chmod(path.join(directory, 'orca-linux.AppImage'), 0o755)
  const sha256 = await homeAppImageDigest(path.join(directory, 'orca-linux.AppImage'))
  await writeFile(path.join(directory, 'SHA256SUMS.txt'), `${sha256}  orca-linux.AppImage\n`)
  return { directory, sha256 }
}

describe('shared home AppImage transaction and pin reconciliation', () => {
  it('verifies SHA256 and extracted marker before changing the installed image', async () => {
    const root = await fixture()
    const previous = await stage(root, 'old verified image')
    await commitHomeAppImage(root, previous.directory, 'v1.4.224-0', extract)
    const next = await stage(root, 'new image')
    await writeFile(
      path.join(next.directory, 'SHA256SUMS.txt'),
      `${'0'.repeat(64)}  orca-linux.AppImage\n`
    )
    await expect(commitHomeAppImage(root, next.directory, 'v1.4.224-1', extract)).rejects.toThrow(
      'checksum mismatch'
    )
    expect((await readFile(path.join(root, 'release-tag'), 'utf8')).trim()).toBe('v1.4.224-0')
    expect(await readFile(path.join(root, 'orca-linux.AppImage'), 'utf8')).toBe(
      'old verified image'
    )
  })
  it('rejects an AppImage missing the required SSH deployment template', async () => {
    const root = await fixture()
    const next = await stage(root, 'missing template image')
    await expect(
      verifyHomeAppImage(next.directory, async (image, cwd) => {
        await extract(image, cwd)
        await rm(path.join(cwd, 'squashfs-root', 'resources', 'orcad-template'), {
          recursive: true
        })
      })
    ).rejects.toThrow('required orcad-template')
  })
  it('rejects an ambiguous checksum and a foreign package marker', async () => {
    const root = await fixture()
    const next = await stage(root, 'image')
    const sums = await readFile(path.join(next.directory, 'SHA256SUMS.txt'), 'utf8')
    await writeFile(path.join(next.directory, 'SHA256SUMS.txt'), sums.repeat(2))
    await expect(verifyHomeAppImage(next.directory, extract)).rejects.toThrow('ambiguous')
    await writeFile(path.join(next.directory, 'SHA256SUMS.txt'), sums)
    await expect(
      verifyHomeAppImage(next.directory, async (_image, cwd) => {
        await extract(_image, cwd)
        await writeFile(path.join(cwd, 'squashfs-root', 'resources', 'package-type'), 'deb')
      })
    ).rejects.toThrow('package-type marker')
  })
  it.each(['journal', 'image', 'checksum', 'pin', 'record'] as const)(
    'recovers forward after interruption at the %s boundary',
    async (boundary) => {
      const root = await fixture()
      const old = await stage(root, 'old')
      await commitHomeAppImage(root, old.directory, 'v1.4.224-0', extract)
      const next = await stage(root, 'next')
      const identity = { tag: 'v1.4.224-1', sha256: next.sha256 }
      await writeFile(
        path.join(root, '.install-pending'),
        JSON.stringify({ ...identity, stage: next.directory })
      )
      if (boundary !== 'journal') {
        await rename(
          path.join(next.directory, 'orca-linux.AppImage'),
          path.join(root, 'orca-linux.AppImage')
        )
      }
      if (['checksum', 'pin', 'record'].includes(boundary)) {
        await writeFile(path.join(root, 'appimage.sha256'), `${next.sha256}  orca-linux.AppImage\n`)
      }
      if (['pin', 'record'].includes(boundary)) {
        await writeFile(path.join(root, 'release-tag'), `${identity.tag}\n`)
      }
      if (boundary === 'record') {
        await writeFile(path.join(root, 'installed-release.json'), JSON.stringify(identity))
      }
      await recoverHomeAppImage(root, extract)
      expect(await reconcileHomeAppImage(root, 'v1.4.224-0', extract)).toEqual(identity)
      expect((await readFile(path.join(root, 'release-tag'), 'utf8')).trim()).toBe(identity.tag)
      expect(await readFile(path.join(root, 'orca-linux.AppImage'), 'utf8')).toBe('next')
    }
  )
  it.each(['missing', 'corrupt', 'older'])(
    'repairs a %s pin from verified current identity',
    async (kind) => {
      const root = await fixture()
      const next = await stage(root, 'next')
      await commitHomeAppImage(root, next.directory, 'v1.4.224-1', extract)
      await (kind === 'missing'
        ? rm(path.join(root, 'release-tag'))
        : writeFile(path.join(root, 'release-tag'), kind === 'corrupt' ? 'broken' : 'v1.4.223-0'))
      expect((await reconcileHomeAppImage(root, 'v1.4.224-0', extract)).tag).toBe('v1.4.224-1')
    }
  )
  it('writes pin, checksum and installed-release.json together on commit', async () => {
    const root = await fixture()
    const next = await stage(root, 'next')
    await commitHomeAppImage(root, next.directory, 'v1.4.227-6', extract)
    const identity = JSON.parse(await readFile(path.join(root, 'installed-release.json'), 'utf8'))
    expect((await readFile(path.join(root, 'release-tag'), 'utf8')).trim()).toBe('v1.4.227-6')
    expect(identity).toEqual({ tag: 'v1.4.227-6', sha256: next.sha256 })
    expect(await readFile(path.join(root, 'appimage.sha256'), 'utf8')).toContain(next.sha256)
  })
  it('heals a stale installed-release.json when pin and checksum match the image', async () => {
    const root = await fixture()
    const next = await stage(root, 'next')
    await commitHomeAppImage(root, next.directory, 'v1.4.227-6', extract)
    await writeFile(
      path.join(root, 'installed-release.json'),
      JSON.stringify({ tag: 'v1.4.224-6', sha256: 'a'.repeat(64) })
    )
    expect(await reconcileHomeAppImage(root, 'v1.4.224-6', extract)).toEqual({
      tag: 'v1.4.227-6',
      sha256: next.sha256
    })
    expect(JSON.parse(await readFile(path.join(root, 'installed-release.json'), 'utf8'))).toEqual({
      tag: 'v1.4.227-6',
      sha256: next.sha256
    })
  })
  it('fails closed on missing identity or an installed downgrade', async () => {
    const root = await fixture()
    const old = await stage(root, 'old')
    await commitHomeAppImage(root, old.directory, 'v1.4.224-0', extract)
    await expect(reconcileHomeAppImage(root, 'v1.4.224-1', extract)).rejects.toThrow('older')
    await rm(path.join(root, 'installed-release.json'))
    await rm(path.join(root, 'release-tag'))
    await expect(reconcileHomeAppImage(root, 'v1.4.224-1', extract)).rejects.toThrow('disagree')
  })
  it('keeps exactly one verified previous image across updates', async () => {
    const root = await fixture()
    for (const suffix of [0, 1, 2]) {
      const next = await stage(root, `image ${suffix}`)
      await commitHomeAppImage(root, next.directory, `v1.4.224-${suffix}`, extract)
    }
    expect(await readFile(path.join(root, 'orca-linux.AppImage.previous'), 'utf8')).toBe('image 1')
    expect((await readFile(path.join(root, 'release-tag.previous'), 'utf8')).trim()).toBe(
      'v1.4.224-1'
    )
  })
  it('rejects rewritten bytes for an installed published tag', async () => {
    const root = await fixture()
    const old = await stage(root, 'original')
    await commitHomeAppImage(root, old.directory, 'v1.4.224-0', extract)
    const changed = await stage(root, 'changed')
    await expect(
      commitHomeAppImage(root, changed.directory, 'v1.4.224-0', extract)
    ).rejects.toThrow('tag bytes changed')
    expect(await readFile(path.join(root, 'orca-linux.AppImage'), 'utf8')).toBe('original')
  })
  it('uses the same exclusive lock for app and ensure actors', async () => {
    const root = await fixture()
    const release = await acquireHomeAppImageLock(root)
    await expect(acquireHomeAppImageLock(root)).rejects.toThrow('holds .install-lock')
    await release()
    await (
      await acquireHomeAppImageLock(root)
    )()
  })
})
