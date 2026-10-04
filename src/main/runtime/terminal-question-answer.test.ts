import { describe, expect, it, vi } from 'vitest'
import { TerminalQuestionAnswer } from './terminal-question-answer'
import type { GrokSessionBinding } from '../../shared/grok-session-binding'

function fixture() {
  const binding: GrokSessionBinding = {
    provider: 'grok',
    sessionId: 'session',
    runtimeId: 'runtime',
    executionHostId: 'local',
    handle: 'handle',
    ptyId: 'pty',
    incarnationId: 'incarnation',
    paneKey: 'pane',
    tabId: 'tab',
    leafId: 'leaf',
    worktreeId: 'worktree',
    boundaryAt: 1000
  }
  const request = { session: 'session', callId: 'call', choice: 2, labelSha256: 'a'.repeat(64) }
  const verified = [
    {
      text: 'Pick one',
      multiSelect: false,
      options: [{ label: 'Alpha' }, { label: 'Beta (Recommended)' }]
    }
  ]
  const authority = {
    resolve: vi.fn(() => ({ ...binding })),
    verify: vi.fn((_binding: GrokSessionBinding) => verified),
    send: vi.fn(
      async (
        _binding: GrokSessionBinding,
        text: string,
        beforeWrite: (ptyId: string) => void | Promise<void>
      ) => {
        await beforeWrite('pty')
        return { handle: 'handle', accepted: true, bytesWritten: Buffer.byteLength(text) }
      }
    )
  }
  return { binding, request, verified, authority, answers: new TerminalQuestionAnswer() }
}
describe('terminal single-choice answer', () => {
  it('writes once with a matching receipt and write-boundary proof', async () => {
    const { answers, request, authority } = fixture()
    expect(await answers.answer(request, authority)).toMatchObject({
      callId: 'call',
      choice: 2,
      accepted: true,
      bytesWritten: 2
    })
    expect(authority.send).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'session' }),
      '\u0015',
      expect.any(Function)
    )
    expect(authority.send.mock.calls.map((call) => call[1])).toEqual(['\u0015', '2'])
    expect(authority.verify).toHaveBeenCalledTimes(4)
    await expect(answers.answer(request, authority)).rejects.toThrow('question_already_submitted')
    expect(authority.send).toHaveBeenCalledTimes(2)
  })
  it('refuses changed ownership at the write boundary', async () => {
    const { answers, request, authority } = fixture()
    authority.resolve
      .mockReturnValueOnce({ ...fixture().binding })
      .mockReturnValueOnce({ ...fixture().binding })
      .mockReturnValue({ ...fixture().binding, incarnationId: 'replacement' })
    await expect(answers.answer(request, authority)).rejects.toThrow('session_binding_changed')
  })
  it('refuses a question completed while send is pending', async () => {
    const { answers, request, authority, verified } = fixture()
    authority.verify
      .mockImplementationOnce(() => verified)
      .mockImplementation(() => {
        throw new Error('question_not_waiting')
      })
    await expect(answers.answer(request, authority)).rejects.toThrow('question_not_waiting')
    await expect(answers.answer(request, authority)).rejects.toThrow('question_already_submitted')
  })
  it('refuses remote authority without any send', async () => {
    const { binding, answers, request, authority } = fixture()
    authority.resolve.mockReturnValue({ ...binding, executionHostId: 'ssh:host' })
    await expect(answers.answer(request, authority)).rejects.toThrow('question_host_unverifiable')
    expect(authority.send).not.toHaveBeenCalled()
  })
  it('writes every single-select question then lets the last digit submit', async () => {
    const { answers, authority, request } = fixture()
    authority.verify.mockReturnValue([
      {
        text: 'First',
        multiSelect: false,
        options: [{ label: 'A' }, { label: 'B' }]
      },
      {
        text: 'Second',
        multiSelect: false,
        options: [{ label: 'C' }, { label: 'D' }]
      }
    ])
    const receipt = await answers.answer(
      {
        session: request.session,
        callId: request.callId,
        answers: [
          { questionIndex: 1, choices: [1], labelSha256s: ['a'.repeat(64)] },
          { questionIndex: 2, choices: [2], labelSha256s: ['b'.repeat(64)] }
        ]
      },
      authority
    )
    expect(authority.send.mock.calls.map((call) => call[1])).toEqual(['\u0015', '1', '\u0015', '2'])
    expect(receipt.bytesWritten).toBe(4)
  })
  it('toggles multi-select options and sends an explicit submit', async () => {
    const { answers, authority, request } = fixture()
    authority.verify.mockReturnValue([
      {
        text: 'Select features',
        multiSelect: true,
        options: [{ label: 'A' }, { label: 'B' }, { label: 'C' }]
      }
    ])
    await answers.answer(
      {
        session: request.session,
        callId: request.callId,
        answers: [
          { questionIndex: 1, choices: [1, 3], labelSha256s: ['a'.repeat(64), 'c'.repeat(64)] }
        ]
      },
      authority
    )
    expect(authority.send.mock.calls.map((call) => call[1])).toEqual([
      '\u0015',
      'g',
      ' ',
      'j',
      'j',
      ' ',
      '\r'
    ])
  })
  it('refuses silently answering only the first question of a batch', async () => {
    const { answers, authority, request } = fixture()
    authority.verify.mockReturnValue([
      {
        text: 'First',
        multiSelect: false,
        options: [{ label: 'A' }, { label: 'B' }]
      },
      {
        text: 'Second',
        multiSelect: false,
        options: [{ label: 'C' }, { label: 'D' }]
      }
    ])
    await expect(answers.answer(request, authority)).rejects.toThrow('question_call_unverifiable')
    expect(authority.send).not.toHaveBeenCalled()
  })
  it('refuses simultaneous duplicate requests', async () => {
    const { answers, request, authority } = fixture()
    const results = await Promise.allSettled([
      answers.answer(request, authority),
      answers.answer(request, authority)
    ])
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected'])
    expect(authority.send).toHaveBeenCalledTimes(2)
  })
})
