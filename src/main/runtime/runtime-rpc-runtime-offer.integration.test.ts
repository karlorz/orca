import './rpc/unused-default-rpc-methods.test-fixture'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { runProcess } from '@orca/process-host'
import { z } from 'zod'
import { listWorktrees, listWorktreesStrict } from '../git/worktree'
import type { Store } from '../persistence'
import { OrcaRuntimeService } from './orca-runtime'
import { OrcaRuntimeRpcServer } from './runtime-rpc'
import { makeStore } from './runtime-rpc-worktree-store-fixtures'
import {
  authenticateMobileWsSession,
  createEncryptedWsResponseReader,
  sendEncryptedWsRequest,
  waitForWsClose
} from './runtime-rpc-mobile-ws-test-harness'
import { PAIRING_METHODS } from './rpc/methods/pairing'
import { STATUS_METHODS } from './rpc/methods/status'
import { TERMINAL_QUERY_METHODS } from './rpc/methods/terminal/terminal-query-methods'

vi.mock('../git/worktree', () => ({
  listWorktrees: vi.fn(),
  listWorktreesStrict: vi.fn()
}))

const offerResponse = z.object({
  ok: z.literal(true),
  result: z.object({ available: z.literal(true), pairingUrl: z.string(), deviceId: z.string() })
})
const terminalResponse = z.object({
  ok: z.literal(true),
  result: z.object({
    terminals: z.array(z.object({ handle: z.string().min(1), ptyId: z.string() }))
  }),
  _meta: z.object({ runtimeId: z.string() })
})
let cliDirectory = ''
let cliEntry = ''

beforeAll(async () => {
  cliDirectory = mkdtempSync(join(tmpdir(), 'orca-cli-'))
  cliEntry = join(cliDirectory, 'cli.cjs')
  const builder = pathToFileURL(join(process.cwd(), 'config/scripts/orcad-entry-build.mjs')).href
  const built = await runProcess({
    program: process.execPath,
    args: [
      '--input-type=module',
      '-e',
      `import {buildOrcadCli} from ${JSON.stringify(builder)}; await buildOrcadCli(${JSON.stringify(cliEntry)});`
    ],
    env: { ...process.env, ORCA_BACKGROUND_LAUNCH: '1' },
    timeoutMs: 60_000
  })
  expect(built.code, built.stderr).toBe(0)
})

afterAll(() => rmSync(cliDirectory, { recursive: true, force: true }))

async function cli(profile: string, args: string[]): Promise<unknown> {
  const result = await runProcess({
    program: process.execPath,
    args: [cliEntry, ...args, '--json'],
    env: {
      ...process.env,
      ORCA_BACKGROUND_LAUNCH: '1',
      ORCA_USER_DATA_PATH: profile,
      ORCA_ENVIRONMENT: '',
      ORCA_PAIRING_CODE: '',
      ORCA_REMOTE_PAIRING: ''
    },
    timeoutMs: 10_000
  })
  expect(result.timedOut).toBe(false)
  expect(result.code, result.stderr).toBe(0)
  const response: unknown = JSON.parse(result.stdout)
  return response
}

describe('CLI runtime pairing against a headless server', () => {
  it.each(['git', 'folder'] as const)(
    'pairs a second client to the same %s workspace handles and refuses remote reminting',
    async (kind) => {
      const directory = mkdtempSync(join(tmpdir(), 'rp-'))
      const hostProfile = join(directory, 'h')
      const clientProfile = join(directory, 'client')
      const workspacePath = join(directory, 'workspace')
      for (const path of [hostProfile, clientProfile, workspacePath]) {
        mkdirSync(path)
      }
      const worktreeId = `repo-1::${workspacePath}`
      const repo = {
        ...makeStore().getRepos()[0],
        id: 'repo-1',
        path: workspacePath,
        kind
      }
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The existing store fixture supplies the repository and settings reads used by terminal listing.
      const store = {
        ...makeStore(),
        getRepos: () => [repo],
        getRepo: () => repo
      } as unknown as Store
      const worktrees = [
        {
          path: workspacePath,
          head: 'abc',
          branch: 'feature/pairing',
          isBare: false,
          isMainWorktree: true
        }
      ]
      vi.mocked(listWorktrees).mockResolvedValue(worktrees)
      vi.mocked(listWorktreesStrict).mockResolvedValue(worktrees)
      const runtime = new OrcaRuntimeService(store)
      const server = new OrcaRuntimeRpcServer({
        methods: [...PAIRING_METHODS, ...STATUS_METHODS, ...TERMINAL_QUERY_METHODS],
        runtime,
        userDataPath: hostProfile,
        enableWebSocket: true,
        pinnedBindHost: '127.0.0.1',
        wsPort: 0
      })
      runtime.registerPty('pairing-pty', worktreeId, null)

      try {
        await server.start()
        const mint = async (rotate = false) =>
          offerResponse.parse(
            await cli(hostProfile, [
              'pairing',
              'offer',
              '--scope',
              'runtime',
              '--pairing-address',
              '127.0.0.1',
              ...(rotate ? ['--rotate'] : [])
            ])
          )
        const first = await mint()
        const reused = await mint()
        expect(reused.result).toMatchObject({ deviceId: first.result.deviceId })
        const rotated = await mint(true)
        expect(rotated.result.deviceId).not.toBe(first.result.deviceId)
        expect(server.getDeviceRegistry()?.getDevice(first.result.deviceId)).toBeNull()
        expect(
          await cli(clientProfile, [
            'environment',
            'add',
            '--name',
            'headless',
            '--pairing-code',
            rotated.result.pairingUrl
          ])
        ).toMatchObject({ ok: true })
        const listArgs = ['terminal', 'list', '--worktree', `id:${worktreeId}`]
        const localList = terminalResponse.parse(await cli(hostProfile, listArgs))
        const pairedList = terminalResponse.parse(
          await cli(clientProfile, [...listArgs, '--environment', 'headless'])
        )
        const handles = localList.result.terminals.map((terminal) => terminal.handle)
        expect(localList.result.terminals).toEqual([
          expect.objectContaining({ ptyId: 'pairing-pty', handle: expect.any(String) })
        ])
        expect(pairedList.result.terminals.map((terminal) => terminal.handle)).toEqual(handles)
        expect(pairedList._meta.runtimeId).toBe(localList._meta.runtimeId)
        expect(pairedList._meta.runtimeId).toBe(runtime.getRuntimeId())

        const session = await authenticateMobileWsSession(rotated.result.pairingUrl)
        const reader = createEncryptedWsResponseReader(session)
        const mintSpy = vi.spyOn(server, 'createPairingOffer')
        try {
          sendEncryptedWsRequest(session, {
            id: 'remote-remint',
            method: 'pairing.createOffer',
            params: { rotate: true }
          })
          expect(await reader.next('remote-remint')).toMatchObject({
            ok: false,
            error: { code: 'forbidden' }
          })
          expect(mintSpy).not.toHaveBeenCalled()
          expect(server.getDeviceRegistry()?.getDevice(rotated.result.deviceId)).not.toBeNull()
        } finally {
          reader.dispose()
          session.ws.close()
          await waitForWsClose(session.ws)
          mintSpy.mockRestore()
        }
      } finally {
        await server.stop()
        rmSync(directory, { recursive: true, force: true })
      }
    }
  )
})
