import { afterEach, describe, expect, it } from 'vitest'
import {
  getHostConnectionRetainRuntime,
  resetHostConnectionRetainRuntimeForTests,
  setHostConnectionRetainRuntime,
  shouldRetainHostConnection,
  subscribeHostConnectionRetainRuntime
} from './host-connection-retain'

describe('shouldRetainHostConnection', () => {
  it('is false unless pet speech, persist hold, and the opt-in are all true', () => {
    expect(
      shouldRetainHostConnection({
        persistHeld: true,
        keepHostConnection: true,
        petSpeechEnabled: true
      })
    ).toBe(true)
    expect(
      shouldRetainHostConnection({
        persistHeld: false,
        keepHostConnection: true,
        petSpeechEnabled: true
      })
    ).toBe(false)
    expect(
      shouldRetainHostConnection({
        persistHeld: true,
        keepHostConnection: false,
        petSpeechEnabled: true
      })
    ).toBe(false)
    expect(
      shouldRetainHostConnection({
        persistHeld: true,
        keepHostConnection: true,
        petSpeechEnabled: false
      })
    ).toBe(false)
  })
})

describe('host connection retain runtime', () => {
  afterEach(() => {
    resetHostConnectionRetainRuntimeForTests()
  })

  it('defaults off and notifies subscribers when the runtime flag changes', () => {
    const seen: boolean[] = []
    const unsub = subscribeHostConnectionRetainRuntime((retain) => {
      seen.push(retain)
    })

    expect(getHostConnectionRetainRuntime()).toBe(false)
    setHostConnectionRetainRuntime(true)
    setHostConnectionRetainRuntime(true)
    setHostConnectionRetainRuntime(false)

    expect(seen).toEqual([true, false])
    unsub()
  })
})
