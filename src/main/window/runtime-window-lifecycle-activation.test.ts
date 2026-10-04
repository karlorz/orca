import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { BrowserWindow, IpcMain, IpcMainEvent } from 'electron'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import type { RuntimeNotifier } from '../runtime/runtime-notifier-contract'

const mockAppFocus = vi.fn()
const mockSafelyRevealWindow = vi.fn()
let mockIsBackgroundLaunch = false

vi.mock('electron', () => ({
  app: { focus: (...args: unknown[]) => mockAppFocus(...args) },
  ipcMain: { on: vi.fn(), removeListener: vi.fn() }
}))
vi.mock('./focus-existing-window', () => ({
  safelyRevealWindow: (...args: unknown[]) => mockSafelyRevealWindow(...args)
}))
vi.mock('./foreground-activation-policy', () => ({
  isBackgroundLaunch: () => mockIsBackgroundLaunch
}))
vi.mock('../ipc/worktree-change-invalidators', () => ({ runWorktreeChangeInvalidators: vi.fn() }))
vi.mock('./mobile-markdown-request-relay', () => ({ requestMobileMarkdownFromRenderer: vi.fn() }))
vi.mock('./renderer-document-navigation', () => ({ registerRendererDocumentNavigation: vi.fn() }))
vi.mock('./session-tab-close-request-relay', () => ({
  requestSessionTabCloseFromRenderer: vi.fn()
}))
vi.mock('./terminal-tab-close-request-relay', () => ({
  requestTerminalTabCloseFromRenderer: vi.fn()
}))

import { registerRuntimeWindowLifecycle } from './runtime-window-lifecycle'
import { ipcMain } from 'electron'

describe('runtime window lifecycle existing-session activation policy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsBackgroundLaunch = false
  })

  function setup() {
    let replyHandler: ((event: unknown, reply: unknown) => void) | null = null
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: Test mock returns the ipcMain instance to satisfy Electron's method chain contract.
    vi.mocked(ipcMain.on).mockImplementation(((
      event: string,
      handler: (event: IpcMainEvent, ...args: unknown[]) => void
    ): IpcMain => {
      if (event === 'terminal:tabCreateReply') {
        // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: Test harnesses dispatch synthetic replies via this captured event handler.
        replyHandler = handler as unknown as (event: unknown, reply: unknown) => void
      }
      return ipcMain
    }) as unknown as typeof ipcMain.on)

    const send = vi.fn(() => true)
    const attached: { notifier: RuntimeNotifier | null } = { notifier: null }
    const mainWindow = {
      id: 1,
      isDestroyed: () => false,
      isFocused: () => true,
      on: vi.fn(),
      webContents: { isDestroyed: () => false, send, on: vi.fn() }
    }
    const runtime = {
      attachWindow: vi.fn(),
      markGraphReloadFailed: vi.fn(),
      setNotifier: (next: RuntimeNotifier | null) => {
        attached.notifier = next
      }
    }
    registerRuntimeWindowLifecycle(
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The registration function only calls id, isDestroyed, on and webContents on mainWindow.
      mainWindow as unknown as BrowserWindow,
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The registration function only calls attachWindow, markGraphReloadFailed and setNotifier on runtime.
      runtime as unknown as OrcaRuntimeService
    )
    return {
      notifier: attached.notifier!,
      send,
      mainWindow,
      deliverReply: (reply: unknown) => {
        replyHandler?.({ sender: mainWindow.webContents }, reply)
      }
    }
  }

  const validProcessIdentity = {
    terminalHandle: 'term_1',
    incarnationId: 'inc_1'
  }

  it('activates macOS app and window after a verified matching reply when the caller authorized host activation', async () => {
    const { notifier, send, deliverReply } = setup()
    const revealPromise = notifier.revealTerminalSession?.('wt-1', {
      ptyId: 'pty-1',
      tabId: 'tab-1',
      leafId: 'leaf-1',
      existingSessionOnly: true,
      activateHostWindow: true,
      expectedProcessIdentity: validProcessIdentity,
      canFocusExistingSession: () => true
    })

    expect(send).toHaveBeenCalledTimes(1)
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: Inspect the first argument tuple passed to mock send.
    const sendCalls = send.mock.calls as unknown as [string, { requestId: string }][]
    const createCall = sendCalls[0][1]
    expect(mockAppFocus).not.toHaveBeenCalled()
    expect(mockSafelyRevealWindow).not.toHaveBeenCalled()

    deliverReply({
      requestId: createCall.requestId,
      tabId: 'tab-1',
      identity: { worktreeId: 'wt-1', tabId: 'tab-1', leafId: 'leaf-1', ptyId: 'pty-1' },
      paneFocused: true
    })

    const result = await revealPromise
    expect(result).toMatchObject({ tabId: 'tab-1', windowFocused: true, paneFocused: true })
    if (process.platform === 'darwin') {
      expect(mockAppFocus).toHaveBeenCalledWith({ steal: true })
    }
    expect(mockSafelyRevealWindow).toHaveBeenCalledTimes(1)
  })

  it('performs zero activation for an exact session reveal the caller did not authorize for this host', async () => {
    const { notifier, send, deliverReply } = setup()
    const revealPromise = notifier.revealTerminalSession?.('wt-1', {
      ptyId: 'pty-1',
      tabId: 'tab-1',
      leafId: 'leaf-1',
      existingSessionOnly: true,
      expectedProcessIdentity: validProcessIdentity,
      canFocusExistingSession: () => true
    })

    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: Inspect the first argument tuple passed to mock send.
    const sendCalls = send.mock.calls as unknown as [string, { requestId: string }][]
    const createCall = sendCalls[0][1]
    deliverReply({
      requestId: createCall.requestId,
      tabId: 'tab-1',
      identity: { worktreeId: 'wt-1', tabId: 'tab-1', leafId: 'leaf-1', ptyId: 'pty-1' },
      paneFocused: true
    })

    // Why: focus fields are observations, not the acknowledgement.
    await expect(revealPromise).resolves.toMatchObject({
      tabId: 'tab-1',
      windowFocused: true,
      paneFocused: true
    })
    expect(mockAppFocus).not.toHaveBeenCalled()
    expect(mockSafelyRevealWindow).not.toHaveBeenCalled()
  })

  it('performs zero activation when revalidation refuses before send', async () => {
    const { notifier, send } = setup()
    await expect(
      notifier.revealTerminalSession?.('wt-1', {
        ptyId: 'pty-1',
        tabId: 'tab-1',
        leafId: 'leaf-1',
        existingSessionOnly: true,
        activateHostWindow: true,
        expectedProcessIdentity: validProcessIdentity,
        canFocusExistingSession: () => false
      })
    ).rejects.toThrow('session_navigation_unverifiable')

    expect(send).not.toHaveBeenCalled()
    expect(mockAppFocus).not.toHaveBeenCalled()
    expect(mockSafelyRevealWindow).not.toHaveBeenCalled()
  })

  it('performs zero activation when binding callback becomes false AFTER send during reveal', async () => {
    const { notifier, send, deliverReply } = setup()
    let canFocus = true
    const revealPromise = notifier.revealTerminalSession?.('wt-1', {
      ptyId: 'pty-1',
      tabId: 'tab-1',
      leafId: 'leaf-1',
      existingSessionOnly: true,
      activateHostWindow: true,
      expectedProcessIdentity: validProcessIdentity,
      canFocusExistingSession: () => canFocus
    })

    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: Inspect the first argument tuple passed to mock send.
    const sendCalls = send.mock.calls as unknown as [string, { requestId: string }][]
    const createCall = sendCalls[0][1]
    // Invalidate binding after send before reply
    canFocus = false

    deliverReply({
      requestId: createCall.requestId,
      tabId: 'tab-1',
      identity: { worktreeId: 'wt-1', tabId: 'tab-1', leafId: 'leaf-1', ptyId: 'pty-1' },
      paneFocused: true
    })

    await expect(revealPromise).rejects.toThrow('session_navigation_unverifiable')
    expect(mockAppFocus).not.toHaveBeenCalled()
    expect(mockSafelyRevealWindow).not.toHaveBeenCalled()
  })

  it('performs zero activation when reply has wrong identity or missing identity', async () => {
    const { notifier, send, deliverReply } = setup()
    const revealPromise = notifier.revealTerminalSession?.('wt-1', {
      ptyId: 'pty-1',
      tabId: 'tab-1',
      leafId: 'leaf-1',
      existingSessionOnly: true,
      activateHostWindow: true,
      expectedProcessIdentity: validProcessIdentity,
      canFocusExistingSession: () => true
    })

    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: Inspect the first argument tuple passed to mock send.
    const sendCalls = send.mock.calls as unknown as [string, { requestId: string }][]
    const createCall = sendCalls[0][1]

    deliverReply({
      requestId: createCall.requestId,
      tabId: 'tab-1',
      identity: { worktreeId: 'wt-1', tabId: 'tab-1', leafId: 'leaf-wrong', ptyId: 'pty-1' }
    })

    await expect(revealPromise).rejects.toThrow('terminal_reveal_identity_mismatch')
    expect(mockAppFocus).not.toHaveBeenCalled()
    expect(mockSafelyRevealWindow).not.toHaveBeenCalled()
  })

  it('performs zero activation when expectedProcessIdentity lacks tabId or leafId (unknown/missing identity)', async () => {
    const { notifier, send } = setup()
    await expect(
      notifier.revealTerminalSession?.('wt-1', {
        ptyId: 'pty-1',
        existingSessionOnly: true,
        activateHostWindow: true,
        expectedProcessIdentity: validProcessIdentity,
        canFocusExistingSession: () => true
      })
    ).rejects.toThrow('terminal_reveal_identity_required')

    expect(send).not.toHaveBeenCalled()
    expect(mockAppFocus).not.toHaveBeenCalled()
    expect(mockSafelyRevealWindow).not.toHaveBeenCalled()
  })

  it('performs zero activation when reply is an error', async () => {
    const { notifier, send, deliverReply } = setup()
    const revealPromise = notifier.revealTerminalSession?.('wt-1', {
      ptyId: 'pty-1',
      tabId: 'tab-1',
      leafId: 'leaf-1',
      existingSessionOnly: true,
      activateHostWindow: true,
      expectedProcessIdentity: validProcessIdentity,
      canFocusExistingSession: () => true
    })

    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: Inspect the first argument tuple passed to mock send.
    const sendCalls = send.mock.calls as unknown as [string, { requestId: string }][]
    const createCall = sendCalls[0][1]
    deliverReply({
      requestId: createCall.requestId,
      error: 'terminal_reveal_identity_mismatch'
    })

    await expect(revealPromise).rejects.toThrow('terminal_reveal_identity_mismatch')
    expect(mockAppFocus).not.toHaveBeenCalled()
    expect(mockSafelyRevealWindow).not.toHaveBeenCalled()
  })

  it('performs zero app.focus in background launch mode even on verified reply', async () => {
    mockIsBackgroundLaunch = true
    const { notifier, send, deliverReply } = setup()
    const revealPromise = notifier.revealTerminalSession?.('wt-1', {
      ptyId: 'pty-1',
      tabId: 'tab-1',
      leafId: 'leaf-1',
      existingSessionOnly: true,
      activateHostWindow: true,
      expectedProcessIdentity: validProcessIdentity,
      canFocusExistingSession: () => true
    })

    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: Inspect the first argument tuple passed to mock send.
    const sendCalls = send.mock.calls as unknown as [string, { requestId: string }][]
    const createCall = sendCalls[0][1]
    deliverReply({
      requestId: createCall.requestId,
      tabId: 'tab-1',
      identity: { worktreeId: 'wt-1', tabId: 'tab-1', leafId: 'leaf-1', ptyId: 'pty-1' },
      paneFocused: true
    })

    await revealPromise
    expect(mockAppFocus).not.toHaveBeenCalled()
    expect(mockSafelyRevealWindow).toHaveBeenCalledTimes(1)
  })

  it('activates the host window for a local legacy switch reveal after its matching reply', async () => {
    const { notifier, send, deliverReply } = setup()
    const revealPromise = notifier.revealTerminalSession?.('wt-1', {
      ptyId: 'pty-1',
      tabId: 'tab-1',
      leafId: 'leaf-1',
      existingSessionOnly: false,
      activateHostWindow: true
    })

    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: Inspect the first argument tuple passed to mock send.
    const sendCalls = send.mock.calls as unknown as [string, { requestId: string }][]
    const createCall = sendCalls[0][1]
    expect(mockAppFocus).not.toHaveBeenCalled()
    expect(mockSafelyRevealWindow).not.toHaveBeenCalled()

    deliverReply({
      requestId: createCall.requestId,
      tabId: 'tab-1',
      identity: { worktreeId: 'wt-1', tabId: 'tab-1', leafId: 'leaf-1', ptyId: 'pty-1' }
    })

    await revealPromise
    if (process.platform === 'darwin') {
      expect(mockAppFocus).toHaveBeenCalledWith({ steal: true })
    }
    expect(mockSafelyRevealWindow).toHaveBeenCalledTimes(1)
  })

  it('performs zero activation for a paired or remote reveal that lacks host authorization', async () => {
    const { notifier, send, deliverReply } = setup()
    const revealPromise = notifier.revealTerminalSession?.('wt-1', {
      ptyId: 'pty-1',
      tabId: 'tab-1',
      leafId: 'leaf-1'
    })

    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: Inspect the first argument tuple passed to mock send.
    const sendCalls = send.mock.calls as unknown as [string, { requestId: string }][]
    const createCall = sendCalls[0][1]
    deliverReply({
      requestId: createCall.requestId,
      tabId: 'tab-1',
      identity: { worktreeId: 'wt-1', tabId: 'tab-1', leafId: 'leaf-1', ptyId: 'pty-1' }
    })

    await expect(revealPromise).resolves.toMatchObject({ tabId: 'tab-1' })
    expect(mockAppFocus).not.toHaveBeenCalled()
    expect(mockSafelyRevealWindow).not.toHaveBeenCalled()
  })

  it('performs zero app.focus for a host-authorized switch in background launch mode', async () => {
    mockIsBackgroundLaunch = true
    const { notifier, send, deliverReply } = setup()
    const revealPromise = notifier.revealTerminalSession?.('wt-1', {
      ptyId: 'pty-1',
      tabId: 'tab-1',
      leafId: 'leaf-1',
      activateHostWindow: true
    })

    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: Inspect the first argument tuple passed to mock send.
    const sendCalls = send.mock.calls as unknown as [string, { requestId: string }][]
    const createCall = sendCalls[0][1]
    deliverReply({
      requestId: createCall.requestId,
      tabId: 'tab-1',
      identity: { worktreeId: 'wt-1', tabId: 'tab-1', leafId: 'leaf-1', ptyId: 'pty-1' }
    })

    await revealPromise
    expect(mockAppFocus).not.toHaveBeenCalled()
    expect(mockSafelyRevealWindow).toHaveBeenCalledTimes(1)
  })

  it('performs zero activation for a host-authorized switch whose reply is an error', async () => {
    const { notifier, send, deliverReply } = setup()
    const revealPromise = notifier.revealTerminalSession?.('wt-1', {
      ptyId: 'pty-1',
      tabId: 'tab-1',
      leafId: 'leaf-1',
      activateHostWindow: true
    })

    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: Inspect the first argument tuple passed to mock send.
    const sendCalls = send.mock.calls as unknown as [string, { requestId: string }][]
    const createCall = sendCalls[0][1]
    deliverReply({ requestId: createCall.requestId, error: 'terminal_reveal_failed' })

    await expect(revealPromise).rejects.toThrow('terminal_reveal_failed')
    expect(mockAppFocus).not.toHaveBeenCalled()
    expect(mockSafelyRevealWindow).not.toHaveBeenCalled()
  })
})
