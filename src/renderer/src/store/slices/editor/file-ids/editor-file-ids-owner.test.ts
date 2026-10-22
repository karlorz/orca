import { describe, expect, it } from 'vitest'
import { isSameEditorOwner, runtimeOwnerKey } from './editor-file-ids'

describe('isSameEditorOwner', () => {
  it('treats trailing-slash worktree path spelling as the same owner', () => {
    expect(
      isSameEditorOwner(
        { worktreeId: 'repo::/worktree', runtimeEnvironmentId: 'env-1' },
        'repo::/worktree/',
        'env-1'
      )
    ).toBe(true)
  })

  it('treats Windows separator and drive-letter case as the same owner', () => {
    expect(
      isSameEditorOwner(
        { worktreeId: 'repo-123::D:/Agentic/game2', runtimeEnvironmentId: 'env-1' },
        'repo-123::D:\\Agentic\\game2',
        'env-1'
      )
    ).toBe(true)
  })

  it('keeps distinct folder workspace instances and environments apart', () => {
    expect(
      isSameEditorOwner(
        {
          worktreeId: 'repo-a::/srv/folder::workspace:123e4567-e89b-12d3-a456-426614174000',
          runtimeEnvironmentId: 'env-1'
        },
        'repo-a::/srv/folder::workspace:123e4567-e89b-12d3-a456-426614174001',
        'env-1'
      )
    ).toBe(false)
    expect(
      isSameEditorOwner(
        { worktreeId: 'repo::/worktree', runtimeEnvironmentId: 'env-1' },
        'repo::/worktree',
        'env-2'
      )
    ).toBe(false)
    expect(runtimeOwnerKey(' env-1 ')).toBe('env-1')
  })
})
