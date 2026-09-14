import { afterEach, describe, expect, it, vi } from 'vitest'

const {
  addPublicListener,
  addNativeListener,
  nativeAddListener,
  nativeRemoveListeners,
  turboAppState
} = vi.hoisted(() => {
  const nativeAddListener = vi.fn()
  const nativeRemoveListeners = vi.fn()
  return {
    addPublicListener: vi.fn(),
    addNativeListener: vi.fn(),
    nativeAddListener,
    nativeRemoveListeners,
    turboAppState: {
      addListener: nativeAddListener,
      removeListeners: nativeRemoveListeners,
      getCurrentAppState: vi.fn()
    }
  }
})

vi.mock('react-native', () => ({
  AppState: {
    currentState: 'active',
    addEventListener: (...args: unknown[]) => addPublicListener(...args)
  },
  NativeEventEmitter: class {
    constructor(public native: unknown) {}
    addListener(event: string, handler: (data: unknown) => void) {
      return addNativeListener(event, handler, this.native)
    }
  },
  NativeModules: {},
  TurboModuleRegistry: {
    get: (name: string) => (name === 'AppState' ? turboAppState : null)
  },
  Platform: { OS: 'android' }
}))

afterEach(() => {
  addPublicListener.mockReset()
  addNativeListener.mockReset()
  nativeAddListener.mockReset()
  nativeRemoveListeners.mockReset()
})

describe('subscribeAppVisibility', () => {
  it('binds the Android TurboModule AppState emitter so pause events reach JS', async () => {
    addPublicListener.mockReturnValue({ remove: vi.fn() })
    const nativeRemove = vi.fn()
    addNativeListener.mockReturnValue({ remove: nativeRemove })

    const { subscribeAppVisibility } = await import('./subscribe-app-visibility')
    const onActive = vi.fn()
    const stop = subscribeAppVisibility(onActive)

    expect(addPublicListener).toHaveBeenCalledWith('change', expect.any(Function))
    expect(addNativeListener).toHaveBeenCalledWith(
      'appStateDidChange',
      expect.any(Function),
      turboAppState
    )
    const nativeHandler = addNativeListener.mock.calls[0]?.[1] as (data: {
      app_state: string
    }) => void
    nativeHandler({ app_state: 'background' })
    expect(onActive).toHaveBeenCalledWith(false)

    expect(turboAppState.getCurrentAppState).toHaveBeenCalled()

    stop()
    expect(nativeRemove).toHaveBeenCalledOnce()
  })
})
