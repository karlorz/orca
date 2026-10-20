import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { wellKnownOrcaUserDataPaths } from '../../shared/well-known-orca-user-data-paths'
import {
  formatSiblingProfileRuntimeWarning,
  warnIfSiblingProfileRuntimeLive
} from './sibling-profile-runtime-warning'

const wellKnown = wellKnownOrcaUserDataPaths('linux', '/home/x', {})

describe('sibling-profile runtime warning', () => {
  it('warns when the other well-known profile has metadata and a live pid', () => {
    const warn = vi.fn()
    warnIfSiblingProfileRuntimeLive({
      thisUserDataPath: wellKnown.electron,
      wellKnown,
      readMetadata: (path) =>
        path === wellKnown.orcad
          ? { runtimeId: 'runtime-b', pid: 42, transports: [], authToken: null, startedAt: 0 }
          : null,
      isPidLive: () => true,
      warn
    })
    expect(warn).toHaveBeenCalledOnce()
    expect(warn.mock.calls[0]?.[0]).toContain('pid 42')
    expect(warn.mock.calls[0]?.[0]).toContain('runtime-b')
    expect(warn.mock.calls[0]?.[0]).toContain(wellKnown.orcad)
    expect(warn.mock.calls[0]?.[0]).not.toContain('orca://')
  })

  it('stays silent when the sibling has no metadata', () => {
    const warn = vi.fn()
    warnIfSiblingProfileRuntimeLive({
      thisUserDataPath: wellKnown.electron,
      wellKnown,
      readMetadata: () => null,
      warn
    })
    expect(warn).not.toHaveBeenCalled()
  })

  it('stays silent when sibling metadata remains after the pid exits', () => {
    const warn = vi.fn()
    warnIfSiblingProfileRuntimeLive({
      thisUserDataPath: wellKnown.electron,
      wellKnown,
      readMetadata: () => ({
        runtimeId: 'runtime-b',
        pid: 42,
        transports: [],
        authToken: null,
        startedAt: 0
      }),
      isPidLive: () => false,
      warn
    })
    expect(warn).not.toHaveBeenCalled()
  })

  it('stays silent when this path is not a well-known profile', () => {
    const warn = vi.fn()
    warnIfSiblingProfileRuntimeLive({
      thisUserDataPath: join('/tmp', 'scratch'),
      wellKnown,
      readMetadata: () => ({
        runtimeId: 'runtime-b',
        pid: 42,
        transports: [],
        authToken: null,
        startedAt: 0
      }),
      warn
    })
    expect(warn).not.toHaveBeenCalled()
  })

  it('formats a warning without a pairing URL', () => {
    expect(
      formatSiblingProfileRuntimeWarning({
        siblingPath: '/root/.orca',
        pid: 9,
        runtimeId: 'abc'
      })
    ).not.toMatch(/orca:\/\//)
  })
})
