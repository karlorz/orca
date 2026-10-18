import { describe, expect, it } from 'vitest'
import { listLocalProcessCwds, type WorktreeGcProcFs } from '../shared/worktree-gc-process-cwd'

function fsError(code: string): Error {
  return Object.assign(new Error(code), { code })
}

function procFs(handlers: {
  names?: string[]
  cwdByPid?: Record<string, string>
  cwdErrorByPid?: Record<string, Error>
  readdirError?: Error
}): WorktreeGcProcFs {
  return {
    async readdir() {
      if (handlers.readdirError) {
        throw handlers.readdirError
      }
      return handlers.names ?? []
    },
    async readlink(target: string) {
      const pid = target.split('/').at(-2) ?? ''
      const error = handlers.cwdErrorByPid?.[pid]
      if (error) {
        throw error
      }
      const cwd = handlers.cwdByPid?.[pid]
      if (cwd === undefined) {
        throw fsError('ENOENT')
      }
      return cwd
    }
  }
}

describe('listLocalProcessCwds', () => {
  it('is unverifiable off Linux', async () => {
    await expect(listLocalProcessCwds('darwin', procFs({ names: ['1'] }))).resolves.toEqual({
      verdict: 'unverifiable'
    })
  })

  it('treats an unreadable live process cwd as unverifiable', async () => {
    await expect(
      listLocalProcessCwds(
        'linux',
        procFs({
          names: ['100', 'cpuinfo'],
          cwdErrorByPid: { '100': fsError('EACCES') }
        })
      )
    ).resolves.toEqual({ verdict: 'unverifiable' })
  })

  it('skips vanished processes and keeps a live scan', async () => {
    await expect(
      listLocalProcessCwds(
        'linux',
        procFs({
          names: ['1', '2'],
          cwdByPid: { '2': '/tmp/keep' },
          cwdErrorByPid: { '1': fsError('ENOENT') }
        })
      )
    ).resolves.toEqual({ verdict: 'live', cwds: ['/tmp/keep'] })
  })

  it('is unverifiable when /proc cannot be listed', async () => {
    await expect(
      listLocalProcessCwds('linux', procFs({ readdirError: fsError('EACCES') }))
    ).resolves.toEqual({ verdict: 'unverifiable' })
  })
})
