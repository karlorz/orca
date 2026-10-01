import { describe, expect, it, vi } from 'vitest'
import type * as ReactModule from 'react'

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactModule>()
  return {
    ...actual,
    useCallback: <T extends (...args: never[]) => unknown>(fn: T) => fn,
    useState: <T>(initial: T) => [initial, vi.fn()] as [T, (value: T) => void]
  }
})

import { useAddRepoLocalFilesystemBrowse } from './add-repo-local-filesystem-browser'

describe('useAddRepoLocalFilesystemBrowse', () => {
  it('skips the native picker on Linux', () => {
    vi.stubGlobal('window', { api: { platform: { get: () => ({ platform: 'linux' }) } } })
    const handleBrowse = vi.fn()
    const { browseLocal } = useAddRepoLocalFilesystemBrowse({
      handleBrowse,
      handleAddLocalPath: vi.fn(),
      initialPath: '~'
    })

    browseLocal()

    expect(handleBrowse).not.toHaveBeenCalled()
  })

  it('opens the native picker on macOS', () => {
    vi.stubGlobal('window', { api: { platform: { get: () => ({ platform: 'darwin' }) } } })
    const handleBrowse = vi.fn().mockResolvedValue(undefined)
    const { browseLocal } = useAddRepoLocalFilesystemBrowse({
      handleBrowse,
      handleAddLocalPath: vi.fn(),
      initialPath: '~'
    })

    browseLocal()

    expect(handleBrowse).toHaveBeenCalledOnce()
  })
})
