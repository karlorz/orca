import { describe, expect, it } from 'vitest'
import { pathWorktreeSelectorForContainedFile } from './runtime-file-routing'

describe('pathWorktreeSelectorForContainedFile', () => {
  it('builds a path: selector from an absolute file and its relative path', () => {
    expect(
      pathWorktreeSelectorForContainedFile(
        '/root/projects/company-coord/out/muse-decorative-a.jpg',
        'out/muse-decorative-a.jpg'
      )
    ).toBe('path:/root/projects/company-coord')
  })

  it('returns null when the relative path is absolute', () => {
    expect(
      pathWorktreeSelectorForContainedFile(
        '/root/projects/company-coord/out/muse-decorative-a.jpg',
        '/root/projects/company-coord/out/muse-decorative-a.jpg'
      )
    ).toBeNull()
  })
})
