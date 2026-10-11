import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { isEnsureManagedHomeAppImage } from './linux-home-update-policy'

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
