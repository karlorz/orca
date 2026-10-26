import type { TerminalDocumentScope } from './document-scope'
import type {
  TerminalDocumentTerminal,
  TerminalDocumentWebglAddon
} from './document-terminal-shape'

// Keep native window reads at call time; embedded pages replace the seams with mount-owned transport, engine and root.

export type TerminalEngineError = string | null | undefined | { message?: unknown }

export type TerminalDocumentViewportRect = {
  left: number
  top: number
  width: number
  height: number
  // Hidden hosts retain their last measured box; fitting waits until shown.
  hidden?: boolean
}

export type TerminalViewportChange = 'resized' | 'shown'

export type TerminalDocumentErrorReporter = (
  message: string | (Event & { message?: unknown }),
  source?: string,
  line?: number,
  column?: number,
  error?: TerminalEngineError
) => void

export type TerminalDocumentHostFrame = string | Record<string, unknown> | undefined

export type TerminalDocumentStart = { textScale: number; shown: boolean }

export type TerminalDocumentHostSeams = {
  postToHost: (message: Record<string, unknown>) => void
  createTerminal: (options: Record<string, unknown>) => TerminalDocumentTerminal
  createUnicode11Addon: () => TerminalDocumentWebglAddon | null
  createWebglAddon: () => TerminalDocumentWebglAddon | null
  installErrorReporter: (report: TerminalDocumentErrorReporter) => () => void
  capturedEngineErrors: () => string[]
  paintDocumentBackground: (background: string) => void
  installHostTransport: (receive: (frame: TerminalDocumentHostFrame) => void) => () => void
  hasEngine: () => boolean
  // Seed scale before ready; only shown documents build engines, respecting the browser’s limited WebGL contexts.
  start: () => TerminalDocumentStart
  viewportRect: () => TerminalDocumentViewportRect
  observeViewport: (onChange: (change: TerminalViewportChange) => void) => () => void
  // Scope element reads to each mount so overlapping route transitions cannot bind both terminals to the first host.
  // Null resolves document at call time for native WebViews instead of capturing it during scope construction.
  root: ParentNode | null
}

// Filter absent and present-undefined overrides so each host retains defaults for seams it does not replace.
export type TerminalDocumentHost = Partial<TerminalDocumentHostSeams>

export type TerminalDocument = {
  send: (message: Record<string, unknown>) => void
  stop: () => void
}

declare global {
  interface Window {
    ReactNativeWebView?: { postMessage: (message: string) => void }
    Unicode11Addon?: { Unicode11Addon: new () => TerminalDocumentWebglAddon }
    WebglAddon?: { WebglAddon?: new () => TerminalDocumentWebglAddon }
    Terminal?: unknown
    // Native shell capture starts before engine loading, so it can report failures that precede document startup.
    __engineErrors?: string[]
    __orcaTerminalTextScale?: unknown
    __orcaTerminalShown?: unknown
  }
  const Terminal: new (options: Record<string, unknown>) => TerminalDocumentTerminal
}

/**
 * Pending React Native bridge deliveries for one document: retries stop with the document so a
 * torn-down page (or a test that drops `window`) never sees a late `send` throw.
 */
export type TerminalDocumentHostPostRetries = {
  hostPostRetryTimers: Set<ReturnType<typeof setTimeout>>
  hostPostStopped: boolean
}

/**
 * The WebView bridge post, with bounded retry — and cancelable when its document stops.
 *
 * Each scope gets its own closure so one document's stop cannot clear another's timers, and a post
 * after stop is a no-op rather than scheduling work nobody will own.
 */
export function createCancellablePostToReactNativeWebView(
  scope: TerminalDocumentHostPostRetries
): (message: Record<string, unknown>) => void {
  return function postToHost(message: Record<string, unknown>) {
    if (scope.hostPostStopped) {
      return
    }
    const payload = JSON.stringify(message)
    let attempts = 0
    function send() {
      if (scope.hostPostStopped) {
        return
      }
      if (typeof window !== 'undefined' && window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(payload)
        return
      }
      attempts++
      if (attempts < 100) {
        const timer = setTimeout(() => {
          scope.hostPostRetryTimers.delete(timer)
          send()
        }, 50)
        scope.hostPostRetryTimers.add(timer)
      }
    }
    send()
  }
}

/** Clears every pending bridge-post retry for this document and refuses further posts. */
export function stopPostToReactNativeWebView(scope: TerminalDocumentScope) {
  scope.hostPostStopped = true
  for (const timer of scope.hostPostRetryTimers) {
    clearTimeout(timer)
  }
  scope.hostPostRetryTimers.clear()
}

/**
 * Default window read without a scope: still used as the seam placeholder before a scope binds its
 * cancellable post. Guards `window` so a stray retry after environment teardown cannot throw.
 */
export function postToReactNativeWebView(message: Record<string, unknown>) {
  const payload = JSON.stringify(message)
  let attempts = 0
  function send() {
    if (typeof window !== 'undefined' && window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(payload)
      return
    }
    attempts++
    if (attempts < 100) {
      setTimeout(send, 50)
    }
  }
  send()
}

export function createEngineTerminal(options: Record<string, unknown>) {
  return new Terminal(options)
}

export function createEngineUnicode11Addon() {
  return window.Unicode11Addon && window.Unicode11Addon.Unicode11Addon
    ? new window.Unicode11Addon.Unicode11Addon()
    : null
}

export function createEngineWebglAddon() {
  return window.WebglAddon && window.WebglAddon.WebglAddon
    ? new window.WebglAddon.WebglAddon()
    : null
}

// Only native WebViews own html/body; embedded pages must paint their host without recoloring the app.
export function paintWindowDocumentBackground(background: string) {
  document.documentElement.style.background = background
  document.body.style.background = background
}

// Native documents own window.onerror; embedded mounts supply a removable listener instead.
export function installWindowErrorReporter(report: TerminalDocumentErrorReporter) {
  window.onerror = report
  return function () {
    window.onerror = null
  }
}

// Native frames arrive on window and Android document events; embedded transport must not consume the shell bridge’s messages.
export function installWindowHostTransport(receive: (frame: TerminalDocumentHostFrame) => void) {
  const listener = (event: Event & { data?: TerminalDocumentHostFrame }) => {
    receive(event.data)
  }
  window.addEventListener('message', listener)
  document.addEventListener('message', listener)
  return function () {
    window.removeEventListener('message', listener)
    document.removeEventListener('message', listener)
  }
}

export function windowCapturedEngineErrors() {
  window.__engineErrors = window.__engineErrors ?? []
  return window.__engineErrors
}

// Native script loading may leave Terminal absent; embedded imports resolve before document construction.
export function windowHasEngine() {
  return window.Terminal !== undefined
}

export function windowStart(): TerminalDocumentStart {
  const scale = window.__orcaTerminalTextScale
  return {
    textScale: typeof scale === 'number' && scale > 0 ? scale : 1,
    shown: window.__orcaTerminalShown !== false
  }
}

// The WebView window is its frame; embedded pages must measure the smaller terminal host.
export function windowViewportRect(): TerminalDocumentViewportRect {
  return { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight }
}

export function observeWindowViewport(onChange: (change: TerminalViewportChange) => void) {
  const listener = () => onChange('resized')
  window.addEventListener('resize', listener)
  return function () {
    window.removeEventListener('resize', listener)
  }
}

// Use root-scoped querySelector for element hosts; document-wide ids collide during route transitions.
export function elementInRoot(root: ParentNode | null, id: string) {
  const within = root === null ? document : root
  return within.querySelector<HTMLElement>(`#${id}`)
}

export type TerminalDocumentTargetContainer = { contains(other: EventTarget | null): boolean }

// Document-level events reach every mount; filter at handler entry so another terminal’s pinch cannot alter this selection.
export function eventTargetInRoot(
  root: TerminalDocumentTargetContainer | null,
  target: EventTarget | null
) {
  if (root === null) {
    return true
  }
  return target !== null && root.contains(target)
}

// Page-wide touches include other terminals; filter before counting fingers or detecting the last release.
// Native root-null returns the original list to avoid frame-rate allocations.
export function touchesInRoot(
  root: TerminalDocumentTargetContainer | null,
  touches: ArrayLike<Touch>
): ArrayLike<Touch> {
  if (root === null) {
    return touches
  }
  const mine: Touch[] = []
  for (let i = 0; i < touches.length; i++) {
    if (eventTargetInRoot(root, touches[i].target)) {
      mine.push(touches[i])
    }
  }
  return mine
}
