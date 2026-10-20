import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  isEnsureManagedHomeAppImage,
  resolveEnsureManagedHomeAppImage
} from './linux-home-update-policy'
import { appImageNamespaceKey } from '../shared/appimage-cache-identity'

const homeDirectory = path.join(tmpdir(), 'orca-policy-home')
const homeImage = {
  platform: 'linux',
  architecture: 'x64',
  packageType: 'non-root',
  managed: '1',
  appImagePath: path.join(homeDirectory, '.local', 'opt', 'orca', 'orca-linux.AppImage'),
  homeDirectory
}

describe('ensure-managed home AppImage updates', () => {
  it('recognizes the home AppImage opt-in', () => {
    expect(isEnsureManagedHomeAppImage(homeImage)).toBe(true)
  })

  it.each([
    { managed: undefined },
    { managed: '0' },
    { packageType: 'deb' },
    { packageType: 'rpm' },
    { packageType: 'unusable' },
    { platform: 'darwin' },
    { platform: 'win32' },
    { architecture: 'arm64' },
    { appImagePath: undefined },
    { appImagePath: 'relative.AppImage' },
    { appImagePath: path.join(homeDirectory, 'orca\0.AppImage') },
    { appImagePath: path.join(tmpdir(), 'outside-policy-home', 'orca-linux.AppImage') },
    { appImagePath: path.join(`${homeDirectory}-shadow`, 'orca-linux.AppImage') },
    { appImagePath: path.join(homeDirectory, '..', 'elsewhere', 'orca-linux.AppImage') },
    { appImagePath: homeDirectory }
  ])('preserves ordinary updater behavior for %o', (override) => {
    expect(isEnsureManagedHomeAppImage({ ...homeImage, ...override })).toBe(false)
  })
})

describe('managed home AppImage cache recovery', () => {
  const roots: string[] = []
  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true })
    }
  })

  function cachedHome(withSource = true, custom = false) {
    const home = mkdtempSync(path.join(tmpdir(), 'orca-home-policy-'))
    roots.push(home)
    const image = path.join(
      home,
      ...(custom ? ['custom'] : ['.local', 'opt', 'orca']),
      'orca-linux.AppImage'
    )
    const namespace = path.join(home, '.cache', 'orca', 'appimage', appImageNamespaceKey(image))
    mkdirSync(namespace, { recursive: true })
    if (withSource) {
      writeFileSync(path.join(namespace, 'source-appimage'), image)
    }
    return {
      ...homeImage,
      managed: undefined,
      appImagePath: undefined,
      homeDirectory: home,
      execPath: path.join(namespace, 'a'.repeat(24), 'orca-ide')
    }
  }

  it.each([true, false])(
    'recovers a canonical home generation with source record=%s',
    (withSource) => {
      const input = cachedHome(withSource)
      expect(resolveEnsureManagedHomeAppImage(input)).toBe(
        path.join(input.homeDirectory, '.local', 'opt', 'orca', 'orca-linux.AppImage')
      )
    }
  )

  it('keeps a recorded custom home root behind the explicit managed opt-in', () => {
    const input = cachedHome(true, true)
    expect(resolveEnsureManagedHomeAppImage(input)).toBeNull()
    expect(resolveEnsureManagedHomeAppImage({ ...input, managed: '1' })).toBe(
      path.join(input.homeDirectory, 'custom', 'orca-linux.AppImage')
    )
  })

  it.each([
    { managed: '0' },
    { packageType: 'deb' },
    { packageType: 'rpm' },
    { packageType: 'unusable' },
    { platform: 'darwin' },
    { platform: 'win32' },
    { architecture: 'arm64' },
    { appImagePath: '/another/orca-linux.AppImage' },
    { execPath: '/opt/Orca/orca-ide' },
    { execPath: path.join(homeDirectory, 'a'.repeat(24), 'invalid-generation', 'orca-ide') }
  ])('does not recover an unrelated runtime or override %o', (override) => {
    expect(resolveEnsureManagedHomeAppImage({ ...cachedHome(), ...override })).toBeNull()
  })

  it('recovers a canonical namespace even when its optional source record is corrupt', () => {
    const input = cachedHome()
    const namespace = path.dirname(path.dirname(input.execPath))
    writeFileSync(path.join(namespace, 'source-appimage'), '/outside/orca-linux.AppImage')
    // The canonical namespace still identifies this install even if its optional record is corrupt.
    expect(resolveEnsureManagedHomeAppImage(input)).toBe(
      path.join(input.homeDirectory, '.local', 'opt', 'orca', 'orca-linux.AppImage')
    )
  })
})
