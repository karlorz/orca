import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  siblingWellKnownUserDataPath,
  wellKnownOrcaUserDataPaths
} from './well-known-orca-user-data-paths'

describe('well-known Orca userData paths', () => {
  it('splits Electron config from orcad data on Linux', () => {
    const paths = wellKnownOrcaUserDataPaths('linux', '/home/x', {})
    expect(paths.electron).toBe(join('/home/x', '.config', 'orca'))
    expect(paths.orcad).toBe(join('/home/x', '.orca'))
    expect(siblingWellKnownUserDataPath(paths.electron, paths)).toBe(paths.orcad)
    expect(siblingWellKnownUserDataPath(paths.orcad, paths)).toBe(paths.electron)
  })

  it('returns null when this path is neither well-known profile', () => {
    const paths = wellKnownOrcaUserDataPaths('linux', '/home/x', {})
    expect(siblingWellKnownUserDataPath('/tmp/other', paths)).toBeNull()
  })

  it('returns null when the two well-known paths coincide', () => {
    expect(
      siblingWellKnownUserDataPath('/home/x/.orca', {
        electron: '/home/x/.orca',
        orcad: '/home/x/.orca'
      })
    ).toBeNull()
  })
})
