import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const callMock = vi.hoisted(() => vi.fn())
const getTerminalHandleMock = vi.hoisted(() => vi.fn())
const printResultMock = vi.hoisted(() => vi.fn())
const originalTerminalHandle = process.env.ORCA_TERMINAL_HANDLE

vi.mock('../format', () => ({ printResult: printResultMock }))
vi.mock('../selectors', () => ({ getTerminalHandle: getTerminalHandleMock }))

import { ORCHESTRATION_HANDLERS } from './orchestration'

const CARD = 'e'.repeat(64)

describe('orchestration unique-bind CLI mapping', () => {
  beforeEach(() => {
    callMock.mockReset()
    printResultMock.mockReset()
    getTerminalHandleMock.mockReset()
    process.env.ORCA_TERMINAL_HANDLE = 'term_creator'
  })

  afterEach(() => {
    if (originalTerminalHandle === undefined) {
      delete process.env.ORCA_TERMINAL_HANDLE
    } else {
      process.env.ORCA_TERMINAL_HANDLE = originalTerminalHandle
    }
  })

  const invoke = (command: string, flags: Map<string, string | boolean>, json = true) =>
    ORCHESTRATION_HANDLERS[command]({
      flags,
      client: { call: callMock },
      cwd: '/tmp/repo',
      json
    } as never)

  it('passes every unique-bind flag through task-create', async () => {
    callMock.mockResolvedValueOnce({ result: { task: { id: 'task_1', status: 'ready' } } })

    await invoke(
      'orchestration task-create',
      new Map<string, string | boolean>([
        ['spec', 'bound work'],
        ['message-id', 'msg_cli_1'],
        ['card', CARD],
        ['intent-job', 'job_cli_1'],
        ['intent-run', 'run_cli_1']
      ])
    )

    expect(callMock).toHaveBeenCalledWith(
      'orchestration.taskCreate',
      expect.objectContaining({
        spec: 'bound work',
        messageId: 'msg_cli_1',
        cardDigest: CARD,
        intentJob: 'job_cli_1',
        intentRun: 'run_cli_1'
      })
    )
  })

  it('keeps unbound task-create additive', async () => {
    callMock.mockResolvedValueOnce({ result: { task: { id: 'task_2', status: 'ready' } } })

    await invoke('orchestration task-create', new Map([['spec', 'plain work']]))

    expect(callMock).toHaveBeenCalledWith(
      'orchestration.taskCreate',
      expect.objectContaining({
        messageId: undefined,
        cardDigest: undefined,
        intentJob: undefined,
        intentRun: undefined
      })
    )
  })

  it('passes the K filters through task-list', async () => {
    callMock.mockResolvedValueOnce({ result: { tasks: [], count: 0 } })

    await invoke(
      'orchestration task-list',
      new Map<string, string | boolean>([
        ['message-id', 'msg_cli_1'],
        ['card', CARD]
      ])
    )

    expect(callMock).toHaveBeenCalledWith(
      'orchestration.taskList',
      expect.objectContaining({ messageId: 'msg_cli_1', cardDigest: CARD })
    )
  })

  it('calls task-show with the task id', async () => {
    callMock.mockResolvedValueOnce({
      result: {
        task: { id: 'task_3', spec: 'bound work', status: 'ready' },
        binding: null,
        intents: []
      }
    })

    await invoke('orchestration task-show', new Map([['id', 'task_3']]))

    expect(callMock).toHaveBeenCalledWith(
      'orchestration.taskShow',
      expect.objectContaining({ id: 'task_3', callerTerminalHandle: 'term_creator' })
    )
    expect(printResultMock).toHaveBeenCalled()
  })

  it('passes --selective and --expect-fence through check', async () => {
    callMock.mockResolvedValueOnce({
      result: {
        target_accept_count: 1,
        unrelated_mutation_count: 0,
        before: [],
        after: [],
        fence: 4
      }
    })

    await invoke(
      'orchestration check',
      new Map<string, string | boolean>([
        ['selective', true],
        ['message-id', 'msg_cli_1'],
        ['expect-fence', '4']
      ])
    )

    expect(callMock).toHaveBeenCalledWith(
      'orchestration.check',
      expect.objectContaining({
        selective: true,
        messageId: 'msg_cli_1',
        expectFence: 4
      })
    )
    expect(printResultMock).toHaveBeenCalled()
  })

  it('rejects a non-integer --expect-fence before calling the runtime', async () => {
    await expect(
      invoke(
        'orchestration check',
        new Map<string, string | boolean>([['expect-fence', 'abc']])
      )
    ).rejects.toMatchObject({ code: 'invalid_argument' })
    expect(callMock).not.toHaveBeenCalled()
  })

  it('requires --message-id with --selective', async () => {
    await expect(
      invoke('orchestration check', new Map<string, string | boolean>([['selective', true]]))
    ).rejects.toMatchObject({ code: 'invalid_argument' })
    expect(callMock).not.toHaveBeenCalled()
  })
})
