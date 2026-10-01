import { describe, expect, it, vi } from 'vitest'
import type * as ReactModule from 'react'

vi.mock('@/runtime/runtime-server-directory-browser', () => ({
  browseRuntimeServerDirectory: vi.fn()
}))

import { useRemoteFileBrowserListing } from './use-remote-file-browser-listing'

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactModule>()
  return {
    ...actual,
    useCallback: <T extends (...args: never[]) => unknown>(fn: T) => fn,
    useRef: <T>(value: T) => ({ current: value })
  }
})

describe('useRemoteFileBrowserListing', () => {
  it('lists a local directory through repos.browseLocalDirectory', async () => {
    const browseLocalDirectory = vi.fn().mockResolvedValue({
      resolvedPath: '/workspace/code',
      pathFlavor: 'posix',
      entries: [{ name: 'portfolio-lab', isDirectory: true, isSymlink: false }]
    })
    vi.stubGlobal('window', {
      api: {
        repos: { browseLocalDirectory },
        ssh: { browseDir: vi.fn() }
      }
    })

    const { fetchListing } = useRemoteFileBrowserListing(undefined, undefined, true)
    const result = await fetchListing('~')

    expect(browseLocalDirectory).toHaveBeenCalledWith({ dirPath: '~' })
    expect(result).toEqual({
      resolvedPath: '/workspace/code',
      pathFlavor: 'posix',
      entries: [{ name: 'portfolio-lab', isDirectory: true, isSymlink: false }]
    })
  })
})
