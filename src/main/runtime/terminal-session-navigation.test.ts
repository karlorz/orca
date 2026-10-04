import { describe, expect, it, vi } from 'vitest'
import { TerminalSessionNavigation } from './terminal-session-navigation'
import type {
  GrokSessionObservation,
  GrokSessionTerminalOwner
} from '../../shared/grok-session-binding'

const owner: GrokSessionTerminalOwner = {
  runtimeId: 'runtime',
  executionHostId: 'local',
  handle: 'terminal',
  ptyId: 'pty',
  incarnationId: 'incarnation',
  paneKey: 'pane',
  tabId: 'tab',
  leafId: 'leaf',
  worktreeId: 'same-directory',
  launchToken: 'launch'
}
function fixture() {
  const observation: GrokSessionObservation = {
    owner,
    sessionId: 'session',
    boundaryAt: Date.now(),
    eventAt: Date.now(),
    retiredSessionIds: []
  }
  const rows = [observation]
  const currentOwner = vi.fn((): GrokSessionTerminalOwner | null => owner)
  const reveal = vi.fn(async () => ({
    identity: {
      worktreeId: owner.worktreeId,
      tabId: owner.tabId,
      leafId: owner.leafId,
      ptyId: owner.ptyId
    },
    windowFocused: false,
    paneFocused: false
  }))
  const navigation = new TerminalSessionNavigation({
    observations: () => rows,
    owner: currentOwner,
    reveal
  })
  return { observation, rows, currentOwner, reveal, navigation }
}
describe('verified session navigation', () => {
  it('opens the exact first-card session in one reveal without inventing focus success', async () => {
    const { navigation, reveal } = fixture()
    expect(await navigation.navigate('session')).toMatchObject({
      navigated: true,
      windowFocused: false,
      paneFocused: false,
      binding: { sessionId: 'session', handle: 'terminal', incarnationId: 'incarnation' }
    })
    expect(reveal).toHaveBeenCalledTimes(1)
    expect(navigation.resolve('session')).not.toHaveProperty('launchToken')
  })
  it('separates two sessions in one directory rather than selecting by workspace or title', () => {
    const { navigation, rows, observation, currentOwner } = fixture()
    const secondOwner = {
      ...owner,
      handle: 'other',
      paneKey: 'other-pane',
      tabId: 'other-tab',
      leafId: 'other-leaf',
      ptyId: 'other-pty'
    }
    rows.push({ ...observation, sessionId: 'other-session', owner: secondOwner })
    currentOwner.mockImplementation((paneKey?: string) =>
      paneKey === 'other-pane' ? secondOwner : owner
    )
    expect(navigation.resolve('other-session').handle).toBe('other')
    expect(navigation.resolve('session').handle).toBe('terminal')
  })
  it('allows an unchanged verified session older than two minutes while live canonical owner matches', async () => {
    const { navigation, observation, reveal } = fixture()
    observation.eventAt = Date.now() - 300_000
    expect(await navigation.navigate('session')).toMatchObject({
      navigated: true,
      binding: { sessionId: 'session', handle: 'terminal', incarnationId: 'incarnation' }
    })
    expect(reveal).toHaveBeenCalledTimes(1)
  })
  it.each(['missing', 'duplicate', 'restored', 'disconnect', 'replacement'])(
    'refuses %s before any reveal',
    async (kind) => {
      const { navigation, rows, observation, currentOwner, reveal } = fixture()
      if (kind === 'missing') {
        rows.length = 0
      }
      if (kind === 'duplicate') {
        rows.push({ ...observation, owner: { ...owner, handle: 'duplicate' } })
      }
      if (kind === 'restored') {
        observation.unverifiable = true
      }
      if (kind === 'disconnect') {
        currentOwner.mockReturnValue(null)
      }
      if (kind === 'replacement') {
        currentOwner.mockReturnValue({ ...owner, incarnationId: 'new' })
      }
      await expect(navigation.navigate('session')).rejects.toThrow()
      expect(reveal).not.toHaveBeenCalled()
    }
  )
  it('refuses a different pane receipt', async () => {
    const { navigation, reveal } = fixture()
    reveal.mockResolvedValue({
      identity: {
        worktreeId: owner.worktreeId,
        tabId: owner.tabId,
        leafId: 'wrong',
        ptyId: owner.ptyId
      },
      windowFocused: true,
      paneFocused: true
    })
    await expect(navigation.navigate('session')).rejects.toThrow('session_navigation_unverifiable')
  })
  it('revalidates the session after asynchronous reveal', async () => {
    const { navigation, reveal, rows } = fixture()
    reveal.mockImplementation(async () => {
      rows.length = 0
      return {
        identity: {
          worktreeId: owner.worktreeId,
          tabId: owner.tabId,
          leafId: owner.leafId,
          ptyId: owner.ptyId
        },
        windowFocused: false,
        paneFocused: false
      }
    })
    await expect(navigation.navigate('session')).rejects.toThrow('session_binding_unverifiable')
  })
})
