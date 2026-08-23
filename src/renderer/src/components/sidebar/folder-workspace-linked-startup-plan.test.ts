import { describe, expect, it } from 'vitest'
import { buildFolderWorkspaceLinkedStartupPlan } from './folder-workspace-composer-submit'

describe('buildFolderWorkspaceLinkedStartupPlan', () => {
  it('carries SSH Codex hook launch slots through a folder workspace plan', () => {
    const plan = buildFolderWorkspaceLinkedStartupPlan({
      agent: 'codex',
      linkedWorkItem: {
        provider: 'github',
        type: 'issue',
        number: 42,
        title: 'Restore remote status',
        url: 'https://github.com/stablyai/orca/issues/42',
        repoId: 'repo-1'
      },
      note: '',
      agentCmdOverrides: {},
      platform: 'linux',
      shell: 'posix',
      isRemote: true
    })

    expect(plan?.launchCommand).toContain(
      'codex $ORCA_CODEX_HOOK_ENABLE_ARG $ORCA_CODEX_HOOK_FEATURE_ARG'
    )
    expect(plan?.env).toMatchObject({
      ORCA_CODEX_HOOK_ENABLE_ARG: '-c',
      ORCA_CODEX_HOOK_FEATURE_ARG: 'features.hooks=false'
    })
  })

  it('uses cmd quoting for configured arguments on local Windows', () => {
    const plan = buildFolderWorkspaceLinkedStartupPlan({
      agent: 'hermes',
      linkedWorkItem: {
        provider: 'github',
        type: 'issue',
        number: 42,
        title: 'Restore linked quick-create',
        url: 'https://github.com/stablyai/orca/issues/42',
        repoId: 'repo-1'
      },
      note: '',
      agentCmdOverrides: {},
      agentArgs: '--provider "value with space"',
      platform: 'win32',
      shell: 'cmd',
      isRemote: false
    })

    expect(plan?.launchCommand).toBe('hermes --tui "--provider" "value with space"')
  })
})
