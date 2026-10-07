import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeTestStores, createSqliteTestStore } from '../persistence-test-harness'
import { installFakeAppEnvironment } from '../../../config/scripts/vitest-host-ports-setup'
import { AgentHookServer } from '../agent-hooks/server'
import { AutomationService } from './service'
import { createAutomationAgentResultSource } from './automation-run-agent-result-source'
import * as discoveryApi from '../../shared/agent-hook-listener/grok-result-discovery'
import { makePaneKey } from '../../shared/stable-pane-id'

const state = { dir: '' }
const paneKey = makePaneKey('tab-1', '11111111-1111-4111-8111-111111111111')
vi.mock('electron', () => ({
  app: { getPath: () => state.dir },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (text: string) => Buffer.from(text),
    decryptString: (text: Buffer) => text.toString()
  }
}))

beforeEach(() => {
  state.dir = mkdtempSync(join(tmpdir(), 'orca-late-automation-result-'))
  vi.stubEnv('HOME', state.dir)
  vi.stubEnv('USERPROFILE', state.dir)
  vi.stubEnv('GROK_HOME', join(state.dir, '.grok'))
})
afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  await closeTestStores()
  rmSync(state.dir, { recursive: true, force: true })
})

describe('durable late automation result', () => {
  it.each(['completed', 'dispatch_failed'] as const)(
    'captures delayed Grok prose after %s without changing verdict or usage',
    async (status) => {
      vi.resetModules()
      installFakeAppEnvironment({ getPath: () => state.dir })
      const { Store, initDataPath } = await import('../persistence')
      initDataPath()
      const store = await createSqliteTestStore(Store, {
        dataFile: join(state.dir, 'orca-data.json')
      })
      store.addRepo({
        id: 'r1',
        path: state.dir,
        displayName: 'test',
        badgeColor: '#fff',
        addedAt: 1
      })
      const automation = store.createAutomation({
        name: 'Review',
        prompt: 'review',
        agentId: 'grok',
        projectId: 'r1',
        workspaceMode: 'existing',
        workspaceId: 'wt-1',
        timezone: 'UTC',
        rrule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0',
        dtstart: Date.now()
      })
      const run = store.createAutomationRun(automation, Date.now(), 'manual')
      let releaseDiscovery: () => void = () => {}
      const discovery = new Promise<void>((resolve) => {
        releaseDiscovery = resolve
      })
      vi.spyOn(discoveryApi, 'preparePendingGrokResultDiscovery').mockReturnValue(discovery)
      const publish = vi.fn()
      const server = new AgentHookServer()
      const service = new AutomationService(store, {
        agentResultSource: createAutomationAgentResultSource(server),
        onAutomationsChanged: publish
      })
      await server.start({ env: 'production' })
      const env = server.buildPtyEnv()
      const sessionId = 'session-1'
      const cwd = join(state.dir, 'workspace')
      const sessionDir = join(state.dir, '.grok', 'sessions', encodeURIComponent(cwd), sessionId)
      mkdirSync(sessionDir, { recursive: true })
      writeFileSync(join(sessionDir, 'chat_history.jsonl'), '')
      const post = async (payload: Record<string, unknown>) => {
        const response = await fetch(`http://127.0.0.1:${env.ORCA_AGENT_HOOK_PORT}/hook/grok`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Orca-Agent-Hook-Token': env.ORCA_AGENT_HOOK_TOKEN
          },
          body: JSON.stringify({
            paneKey,
            tabId: 'tab-1',
            worktreeId: 'wt-1',
            env: 'production',
            payload
          })
        })
        expect(response.status).toBe(204)
      }
      const read = () => {
        const current = store.listAutomationRuns(automation.id).find((entry) => entry.id === run.id)
        if (!current) {
          throw new Error('run missing')
        }
        return current
      }
      try {
        await service.markDispatchResult({
          runId: run.id,
          status: 'dispatching',
          workspaceId: 'wt-1'
        })
        await service.markDispatchResult({
          runId: run.id,
          status: 'dispatched',
          workspaceId: 'wt-1',
          terminalPaneKey: paneKey,
          terminalSessionId: 'tab-1',
          terminalPtyId: 'pty'
        })
        await post({
          hookEventName: 'UserPromptSubmit',
          sessionId,
          promptId: 'p-1',
          prompt: 'review'
        })
        await post({
          hookEventName: 'PostToolUse',
          sessionId,
          toolName: 'read_file',
          toolOutput: 'Missing file'
        })
        await post({
          hookEventName: status === 'dispatch_failed' ? 'StopFailure' : 'Stop',
          sessionId,
          promptId: 'p-1',
          cwd
        })
        const error = status === 'dispatch_failed' ? 'Provider refused the request.' : null
        await service.markDispatchResult({
          runId: run.id,
          status,
          error,
          outputSnapshot: {
            format: 'plain_text',
            content: 'Intermediate output',
            capturedAt: Date.now(),
            truncated: false
          }
        })
        const usage = read().usage
        publish.mockClear()
        writeFileSync(
          join(sessionDir, 'chat_history.jsonl'),
          `${JSON.stringify({ type: 'assistant', content: 'Late final report.' })}\n`
        )
        releaseDiscovery()
        await vi.waitFor(() =>
          expect(server.getStatusSnapshotForPane(paneKey)[0]?.lastAssistantMessage).toBe(
            'Late final report.'
          )
        )
        await vi.waitFor(() => expect(read().outputSnapshot?.content).toBe('Late final report.'))
        expect(read()).toMatchObject({ status, error, usage })
        expect(publish).toHaveBeenCalledWith(expect.objectContaining({ reason: 'run' }))
        await service.markDispatchResult({ runId: run.id, status, error, terminalPtyId: null })
        expect(read().outputSnapshot?.content).toBe('Late final report.')
      } finally {
        releaseDiscovery()
        service.stop()
        server.stop()
      }
    }
  )
})
