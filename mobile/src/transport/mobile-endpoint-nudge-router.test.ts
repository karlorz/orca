import { describe, expect, it, vi } from 'vitest'
import { MobileEndpointNudgeRouter } from './mobile-endpoint-nudge-router'
import type { RelayReconnectController } from './mobile-relay-reconnect-controller'
import type { StableLogicalRpcClient } from './stable-logical-rpc-client'

function routerFixture(shouldRetain = () => false) {
  let foreground = false
  const logical = {
    getActivePath: vi.fn(() => 'relay'),
    getState: vi.fn(() => 'connected'),
    getGeneration: vi.fn(() => 1),
    sendRequest: vi.fn(async () => ({}))
  } as unknown as StableLogicalRpcClient
  const handleActiveNudge = vi.fn(() => 'probe' as const)
  const setForeground = vi.fn((next: boolean) => {
    foreground = next
  })
  const scheduleDirectProbe = vi.fn()
  const router = new MobileEndpointNudgeRouter({
    logical,
    controller: { handleActiveNudge } as unknown as RelayReconnectController,
    isStopped: () => false,
    isForeground: () => foreground,
    shouldRetainHostConnection: shouldRetain,
    setForeground,
    replaceRelay: vi.fn(),
    scheduleDirectProbe
  })
  return { handleActiveNudge, logical, router, scheduleDirectProbe, setForeground }
}

describe('MobileEndpointNudgeRouter', () => {
  it('does not restore foreground from a background focus nudge when retain is off', () => {
    const fixture = routerFixture()

    fixture.router.nudge('focus')

    expect(fixture.setForeground).not.toHaveBeenCalled()
    expect(fixture.handleActiveNudge).not.toHaveBeenCalled()
    expect(fixture.scheduleDirectProbe).not.toHaveBeenCalled()
  })

  it('probes a focus nudge without faking foreground when retain is on', () => {
    const fixture = routerFixture(() => true)

    fixture.router.nudge('focus')

    expect(fixture.setForeground).not.toHaveBeenCalled()
    expect(fixture.handleActiveNudge).toHaveBeenCalledWith(fixture.logical, 'focus')
    expect(fixture.scheduleDirectProbe).toHaveBeenCalledOnce()
  })

  it('ignores a network nudge while backgrounded', () => {
    const fixture = routerFixture()

    fixture.router.nudge('network-change')

    expect(fixture.setForeground).not.toHaveBeenCalled()
    expect(fixture.handleActiveNudge).not.toHaveBeenCalled()
    expect(fixture.scheduleDirectProbe).not.toHaveBeenCalled()
  })

  it('applies a background network nudge when keep-host retain is on', () => {
    const fixture = routerFixture(() => true)

    fixture.router.nudge('network-change')

    expect(fixture.setForeground).not.toHaveBeenCalled()
    expect(fixture.handleActiveNudge).toHaveBeenCalledWith(fixture.logical, 'network-change')
    expect(fixture.scheduleDirectProbe).toHaveBeenCalledOnce()
  })
})
