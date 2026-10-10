import { describe, expect, it } from 'vitest'
import { isEnsureManagedHomeAppImage } from './linux-home-update-policy'

const homeImage = {
  platform: 'linux',
  packageType: 'non-root',
  managed: '1',
  appImagePath: '/home/box/.local/opt/orca/orca-linux.AppImage',
  homeDirectory: '/home/box'
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
    { appImagePath: undefined },
    { appImagePath: 'relative.AppImage' },
    { appImagePath: '/home/box/orca\0.AppImage' },
    { appImagePath: '/opt/Orca/orca-linux.AppImage' },
    { appImagePath: '/home/box-shadow/orca-linux.AppImage' },
    { appImagePath: '/home/box/../elsewhere/orca-linux.AppImage' },
    { appImagePath: '/home/box' }
  ])('preserves ordinary updater behavior for %o', (override) => {
    expect(isEnsureManagedHomeAppImage({ ...homeImage, ...override })).toBe(false)
  })
})
