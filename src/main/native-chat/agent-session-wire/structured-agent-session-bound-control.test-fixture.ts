import { AGENT_JOURNAL_THREAD_SCOPE } from '../../../shared/agent-session-journal-types'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { vi } from 'vitest'
import { computeAgentSessionPayloadFingerprint } from '../../../shared/agent-session-mutation-envelope'
import type { AgentSessionControlTarget } from '../../../shared/agent-session-bound-control'
import { acpLaunchSpecFor } from '../../acp/acp-launch-specs'
import { acpStructuredAgentDefinition } from '../../acp/acp-structured-agent-definitions'
import { openTestAgentSessionRecordStore } from '../../runtime/agent-session-record-store-test-harness'
import {
  openTestJournalHostDatabase,
  closeTestJournalHostDatabase
} from '../agent-session-journal/journal-host-database-test-support'
import { StructuredAgentSessionHost } from './structured-agent-session-host'
import { StructuredAgentRegistry } from './structured-agent-registry'
import type { StructuredAgentSessionAdapter } from './structured-agent-session-adapter'
import { createStructuredAgentSessionLogger } from './structured-agent-session-logger'
import { attachFingerprintFields } from './structured-agent-session-attach'
import {
  HOST_TEST_NOW,
  HOST_TEST_SESSION,
  hostTestAttachParams,
  hostTestMessage,
  hostTestOperationId
} from './structured-agent-session-host-test-data'

export const BOUND_CALLER = { callerKey: 'bound-client' }
export const BOUND_NATIVE = 'native-grok-1'

export async function openBoundControlRig() {
  const root = await mkdtemp(join(tmpdir(), 'orca-bound-'))
  const store = await openTestAgentSessionRecordStore(root)
  const state: {
    generation: string
    nativeSessionId: string
    turnId: string | null
    promptPending: boolean
    live: boolean
    inFlight: boolean
  } = {
    generation: 'child-1',
    nativeSessionId: BOUND_NATIVE,
    turnId: null,
    promptPending: false,
    live: true,
    inFlight: false
  }
  const dispatch = vi.fn<StructuredAgentSessionAdapter['dispatch']>(async (input) => {
    await input.beforeDispatch?.()
    input.beforePromptWrite?.()
    return {
      state: 'accepted',
      providerIdentity: {
        provider: 'legacy',
        agent: 'grok',
        sessionId: BOUND_NATIVE,
        recordId: input.clientMessageId
      }
    }
  })
  const cancelTurn = vi.fn<StructuredAgentSessionAdapter['cancelTurn']>(async (input) => {
    input.beforeCancel?.()
    return { cancelled: true }
  })
  const acquire = vi.fn<StructuredAgentSessionAdapter['acquire']>(async (input) => ({
    acquisitionGeneration: state.generation,
    process: { hostId: 'local', pid: 4242, processStartTimeMs: 1, spawnToken: input.spawnToken },
    link: {
      linkId: `link-${input.fence}`,
      handle: { transport: 'acp', agent: 'grok', nativeId: state.nativeSessionId },
      origin: 'created',
      mintedAtFence: input.fence,
      observedAt: HOST_TEST_NOW
    }
  }))
  const adapter: StructuredAgentSessionAdapter = {
    acquire,
    open: async () => ({ reportedOptions: {} }),
    dispatch,
    cancelTurn,
    answerPrompt: async ({ commit }) => commit(),
    holdsLiveProviderProcess: (_id, generation) => state.live && state.generation === generation,
    holdsDispatch: () => state.inFlight,
    controlBinding: () =>
      state.live
        ? {
            nativeSessionId: state.nativeSessionId,
            acquisitionGeneration: state.generation,
            turnId: state.turnId,
            promptPending: state.promptPending,
            canFollowUp: state.turnId === null && !state.inFlight
          }
        : null,
    supportsCreate: () => true,
    closeSession: async () => {
      state.live = false
      return true
    },
    setOption: async () => undefined
  }
  const spec = acpLaunchSpecFor('grok')
  if (!spec) {
    throw new Error('Grok fixture requires its registered launch spec')
  }
  const definition = acpStructuredAgentDefinition(spec)
  const agents = new StructuredAgentRegistry([
    {
      definition: { ...definition, capabilities: { ...definition.capabilities, compact: false } },
      adapter
    }
  ])
  const host = new StructuredAgentSessionHost({
    store,
    adapter,
    agents,
    journalDatabase: openTestJournalHostDatabase(root),
    claimKeyId: 'fixture-key',
    now: () => HOST_TEST_NOW,
    logger: createStructuredAgentSessionLogger()
  })
  const params = hostTestAttachParams(null, {
    provider: 'grok',
    agent: 'grok',
    providerHandle: undefined,
    accountHome: { variable: 'GROK_HOME', path: root },
    location: {
      executionHostId: 'local',
      workspaceId: root,
      workspaceKind: 'folder',
      wslDistro: null
    }
  })
  const attached = await host.attach(BOUND_CALLER, {
    ...params,
    envelope: {
      ...params.envelope,
      payloadFingerprint: computeAgentSessionPayloadFingerprint({
        method: 'agentSession.attach',
        sessionId: HOST_TEST_SESSION,
        fields: attachFingerprintFields(params)
      })
    }
  })
  if (!attached.ok) {
    throw new Error(`Grok fixture attach refused: ${attached.refusal.code}`)
  }
  const session = host.collaboratorsForTests().sessions.get(HOST_TEST_SESSION)
  if (!session) {
    throw new Error('Grok fixture has no conversation')
  }
  return {
    root,
    store,
    host,
    state,
    adapter,
    dispatch,
    acquire,
    cancelTurn,
    session,
    target: async () => {
      const result = await host.controlTarget({ provider: 'grok', nativeSessionId: BOUND_NATIVE })
      if (!result.supported) {
        throw new Error(`Control target unsupported: ${result.reason}`)
      }
      return result.target
    },
    turn: async (turnId: string, ended = false) => {
      state.turnId = ended ? null : turnId
      await session.journal.appendItem(
        { provider: 'legacy', agent: 'grok', sessionId: BOUND_NATIVE, recordId: `turn:${turnId}` },
        { kind: 'turn', turnId, state: ended ? 'completed' : 'running' },
        { fence: session.child?.fence ?? 1, turnScope: AGENT_JOURNAL_THREAD_SCOPE }
      )
    },
    dispose: async () => {
      await host.flushAllStreamedEvents()
      closeTestJournalHostDatabase(root)
      await rm(root, { recursive: true, force: true })
    }
  }
}

export function boundSend(target: AgentSessionControlTarget, text = 'follow-up') {
  const body = hostTestMessage(text)
  return {
    body,
    expectedControlTarget: target,
    envelope: {
      sessionId: target.sessionId,
      clientOperationId: hostTestOperationId(),
      expectedRuntimeFence: target.runtimeFence,
      payloadFingerprint: computeAgentSessionPayloadFingerprint({
        method: 'agentSession.send',
        sessionId: target.sessionId,
        fields: { body, expectedControlTarget: target }
      })
    }
  }
}

export function boundStop(target: AgentSessionControlTarget) {
  const turn = target.turnId === null ? {} : { turnId: target.turnId }
  return {
    ...turn,
    expectedControlTarget: target,
    envelope: {
      sessionId: target.sessionId,
      clientOperationId: hostTestOperationId(),
      expectedRuntimeFence: target.runtimeFence,
      payloadFingerprint: computeAgentSessionPayloadFingerprint({
        method: 'agentSession.cancel',
        sessionId: target.sessionId,
        fields: { ...turn, expectedControlTarget: target }
      })
    }
  }
}
