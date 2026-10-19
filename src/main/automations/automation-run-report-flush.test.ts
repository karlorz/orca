import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentHookServer } from '../agent-hooks/server'
import { makePaneKey } from '../../shared/stable-pane-id'
import type { AutomationRun } from '../../shared/automations-types'
import { createAutomationAgentResultSource } from './automation-run-agent-result-source'
import { AutomationRunResultCapture } from './automation-run-result-capture'
import { RelayAgentHookServer } from '../../wsl-guest/agent-hook-server'

const paneKey = makePaneKey('tab-report', '11111111-1111-4111-8111-111111111111')
const sessionId = '019e37f4-5135-7b63-a4ab-6d13aa6bf532'
const promptId = 'report-prompt'
const content = `Synthetic report 😀\n${'complete report row\n'.repeat(1000)}`.trim()

afterEach(() => vi.unstubAllEnvs())

describe('automation report flush before terminal retirement', () => {
  it.each([
    { host: 'local', completionHook: 'Stop' },
    { host: 'local', completionHook: 'SessionEnd' },
    { host: 'relay', completionHook: 'Stop' },
    { host: 'relay', completionHook: 'SessionEnd' }
  ])(
    'waits for the exact completed report after a capped $host $completionHook preview',
    async ({ host, completionHook }) => {
      const root = mkdtempSync(join(tmpdir(), 'orca-automation-report-flush-'))
      const cwd = join(root, 'workspace')
      const sessionDir = join(root, '.grok', 'sessions', encodeURIComponent(cwd), sessionId)
      mkdirSync(sessionDir, { recursive: true })
      writeFileSync(
        join(sessionDir, 'chat_history.jsonl'),
        `${JSON.stringify({ type: 'assistant', content })}\n`
      )
      const updates = join(sessionDir, 'updates.jsonl')
      const update = (kind: string, fields: Record<string, unknown> = {}) => ({
        method: kind === 'turn_completed' ? '_x.ai/session/update' : 'session/update',
        params: { sessionId, update: { sessionUpdate: kind, ...fields } }
      })
      writeFileSync(updates, `${JSON.stringify(update('tool_call_update'))}\n`)
      vi.stubEnv('HOME', root)
      vi.stubEnv('USERPROFILE', root)
      const server = new AgentHookServer()
      await server.start({ env: 'production' })
      const relay = new RelayAgentHookServer({
        endpointDir: join(root, 'endpoint'),
        forward: (envelope) => server.ingestRemote(envelope, 'remote-host')
      })
      if (host === 'relay') {
        await relay.start()
      }
      let capture: AutomationRunResultCapture | undefined
      try {
        const env = server.buildPtyEnv()
        const endpoint =
          host === 'relay'
            ? relay.getCoordinates()
            : { port: env.ORCA_AGENT_HOOK_PORT, token: env.ORCA_AGENT_HOOK_TOKEN }
        const post = async (payload: Record<string, unknown>) => {
          const response = await fetch(`http://127.0.0.1:${endpoint.port}/hook/grok`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Orca-Agent-Hook-Token': endpoint.token
            },
            body: JSON.stringify({
              paneKey,
              tabId: 'tab-report',
              worktreeId: 'workspace',
              env: host === 'relay' ? 'remote' : 'production',
              payload: { sessionId, cwd, ...payload }
            })
          })
          expect(response.status).toBe(204)
        }
        let run: AutomationRun = {
          id: 'run',
          automationId: 'automation',
          title: 'Report flush',
          scheduledFor: Date.now(),
          status: 'dispatched',
          trigger: 'manual',
          workspaceId: 'workspace',
          sessionKind: 'terminal',
          chatSessionId: null,
          terminalSessionId: 'tab-report',
          terminalPaneKey: paneKey,
          terminalPtyId: 'pty',
          outputSnapshot: null,
          precheckResult: null,
          usage: null,
          error: null,
          startedAt: Date.now() - 10,
          dispatchedAt: Date.now() - 10,
          createdAt: Date.now() - 10,
          providerSessionId: sessionId
        }
        await post({ hookEventName: 'UserPromptSubmit', prompt: 'report', promptId })
        capture = new AutomationRunResultCapture({
          source: createAutomationAgentResultSource(server),
          readRun: () => run,
          writeSnapshot: async (_current, outputSnapshot) => {
            run = { ...run, outputSnapshot }
            return run
          }
        })
        capture.track(run)
        await post({ hookEventName: 'Stop', promptId })
        if (completionHook === 'SessionEnd') {
          await post({ hookEventName: 'SessionEnd' })
        }
        const preview = server.getStatusSnapshotForPane(paneKey)[0]
        expect(preview.lastAssistantMessage?.trim()).toBe(content.slice(0, 8000).trim())
        expect(
          server.getAutomationResultRowsForPane(paneKey)[0].automationAssistantResult
        ).toBeUndefined()
        run = { ...run, status: 'completed' }
        let retired = false
        const finalization = capture.refresh(run).then((result) => {
          retired = true
          return result
        })
        await new Promise((resolve) => setTimeout(resolve, 70))
        expect(retired).toBe(false)
        writeFileSync(
          updates,
          `${[
            update('tool_call_update'),
            update('agent_message_chunk', { content: { type: 'text', text: content } }),
            update('turn_completed', { prompt_id: promptId, stop_reason: 'end_turn' })
          ]
            .map((row) => JSON.stringify(row))
            .join('\n')}\n`
        )
        const completed = await finalization
        expect(retired).toBe(true)
        expect(completed.outputSnapshot).toMatchObject({
          format: 'plain_text',
          content,
          truncated: false
        })
        expect(completed.status).toBe('completed')
        expect(server.getStatusSnapshotForPane(paneKey)[0].lastAssistantMessage?.trim()).toBe(
          content.slice(0, 8000).trim()
        )
      } finally {
        capture?.dispose()
        relay.stop()
        server.stop()
        rmSync(root, { recursive: true, force: true })
      }
    }
  )
})
