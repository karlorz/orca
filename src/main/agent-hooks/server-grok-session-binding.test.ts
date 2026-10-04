import { afterEach, describe, expect, it } from 'vitest'
import { AgentHookServer } from './server'
import { normalizeHookPayload } from '../../shared/agent-hook-listener'
import type { AgentHookEventPayload } from '../../shared/agent-hook-listener/listener-event'
import type { GrokSessionTerminalOwner } from '../../shared/grok-session-binding'

class BindingTestServer extends AgentHookServer {
  ingestGrok(payload: Record<string, unknown>): void {
    const event = normalizeHookPayload(
      this.state,
      'grok',
      {
        env: 'production',
        paneKey: owner.paneKey,
        tabId: owner.tabId,
        worktreeId: owner.worktreeId,
        launchToken: owner.launchToken,
        payload: JSON.stringify(payload)
      },
      'production'
    )
    if (event) {
      this.applyNormalizedStatus(event)
    }
  }

  repaint(): void {
    const row = this.state.lastStatusByPaneKey.get(owner.paneKey)
    if (row) {
      const repaint: AgentHookEventPayload = { ...row, source: undefined, hookEventName: undefined }
      this.applyNormalizedStatus(repaint, undefined, 'osc')
    }
  }
}

const owner: GrokSessionTerminalOwner = {
  runtimeId: 'runtime',
  executionHostId: 'local',
  handle: 'terminal',
  ptyId: 'pty',
  incarnationId: 'incarnation',
  paneKey: 'tab:11111111-1111-4111-8111-111111111111',
  tabId: 'tab',
  leafId: '11111111-1111-4111-8111-111111111111',
  worktreeId: 'worktree',
  launchToken: 'launch'
}
const servers: BindingTestServer[] = []
afterEach(() => servers.splice(0).forEach((server) => server.stop()))

function fixture(): BindingTestServer {
  const server = new BindingTestServer()
  server.setSessionTerminalOwnerResolver(() => owner)
  servers.push(server)
  return server
}

describe('Grok binding in the existing canonical hook row', () => {
  it('retains live SessionStart identity without a working status or a public routing credential', () => {
    const server = fixture()
    server.ingestGrok({
      hook_event_name: 'SessionStart',
      sessionId: 'session',
      timestamp: new Date().toISOString()
    })
    expect(server.getGrokSessionObservations()).toHaveLength(1)
    expect(server.getStatusSnapshot()[0]).toMatchObject({
      providerSessionOnly: true,
      state: 'done'
    })
    expect(server.getStatusSnapshot()[0]).not.toHaveProperty('grokSessionObservation')
  })
  it('does not let an OSC repaint erase the observed session boundary', () => {
    const server = fixture()
    server.ingestGrok({
      hook_event_name: 'SessionStart',
      sessionId: 'session',
      timestamp: new Date().toISOString()
    })
    server.repaint()
    expect(server.getGrokSessionObservations()[0]?.sessionId).toBe('session')
  })
  it('binds a live pane from a waiting AUQ hook when SessionStart never landed', () => {
    const server = fixture()
    server.ingestGrok({
      hook_event_name: 'PreToolUse',
      sessionId: 'session',
      toolName: 'ask_user_question',
      timestamp: new Date().toISOString()
    })
    expect(server.getGrokSessionObservations()).toHaveLength(1)
    expect(server.getGrokSessionObservations()[0]?.sessionId).toBe('session')
  })
  it('cannot establish a binding from an unconfirmed startup or a child SessionStart', () => {
    const server = fixture()
    server.ingestGrok({
      hook_event_name: 'SessionStart',
      sessionId: 'child',
      subagentType: 'worker',
      timestamp: new Date().toISOString()
    })
    expect(server.getGrokSessionObservations()).toEqual([])
    server.ingestGrok({ hook_event_name: 'SessionStart', sessionId: 'session' })
    expect(server.getGrokSessionObservations()).toEqual([])
  })
})
