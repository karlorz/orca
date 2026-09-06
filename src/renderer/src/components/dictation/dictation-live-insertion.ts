import { computeLiveTranscriptDelta } from '../../../../shared/dictation-live-delta'
import { insertText, type DictationInsertionTarget } from './dictation-insertion-target'

export type DictationLiveInserter = {
  readonly hasTarget: boolean
  applyPartial: (text: string) => boolean
  freezeSegment: (text: string) => boolean
}

type MutableLiveState = {
  target: DictationInsertionTarget
  activeSegment: string
  frozen: boolean
  textAnchor: number | null
}

function dispatchTextInput(element: HTMLInputElement | HTMLTextAreaElement, data: string): void {
  element.dispatchEvent(
    new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data })
  )
}

function replaceTextControlSegment(
  element: HTMLInputElement | HTMLTextAreaElement,
  anchor: number,
  previous: string,
  next: string
): boolean {
  if (!element.isConnected) {
    return false
  }
  const current = element.value.slice(anchor, anchor + previous.length)
  if (current !== previous) {
    return false
  }
  element.focus()
  element.setRangeText(next, anchor, anchor + previous.length, 'end')
  dispatchTextInput(element, next)
  return true
}

function replaceContentEditableSegment(
  element: HTMLElement,
  previous: string,
  next: string
): boolean {
  if (!element.isConnected || !element.contains(element.ownerDocument.activeElement)) {
    return false
  }
  const selection = element.ownerDocument.getSelection()
  if (!selection) {
    return false
  }
  const delta = computeLiveTranscriptDelta(previous, next)
  for (let i = 0; i < delta.deleteGraphemes; i += 1) {
    selection.modify?.('extend', 'backward', 'character')
  }
  const editor = element.closest('.ProseMirror, [contenteditable="true"]') ?? element
  const beforeInput = new InputEvent('beforeinput', {
    bubbles: true,
    cancelable: true,
    inputType: 'insertText',
    data: delta.insertText
  })
  if (!editor.dispatchEvent(beforeInput)) {
    return true
  }
  if (delta.insertText) {
    element.ownerDocument.execCommand?.('insertText', false, delta.insertText)
  } else if (delta.deleteGraphemes > 0) {
    element.ownerDocument.execCommand?.('delete', false)
  }
  return true
}

function replaceTerminalSegment(
  target: Extract<DictationInsertionTarget, { kind: 'terminal' }>,
  previous: string,
  next: string
): void {
  const delta = computeLiveTranscriptDelta(previous, next)
  document.dispatchEvent(
    new CustomEvent('dictation:replaceText', {
      detail: {
        tabId: target.tabId,
        paneId: target.paneId,
        backspaces: delta.deleteGraphemes,
        text: delta.insertText,
        liveSegment: previous
      }
    })
  )
}

function applyToTarget(state: MutableLiveState, previous: string, next: string): boolean {
  const { target } = state
  if (target.kind === 'text') {
    if (state.textAnchor === null) {
      const caret = target.element.selectionStart
      state.textAnchor = typeof caret === 'number' ? caret : target.element.value.length
    }
    return replaceTextControlSegment(target.element, state.textAnchor, previous, next)
  }
  if (target.kind === 'contentEditable') {
    return replaceContentEditableSegment(target.element, previous, next)
  }
  replaceTerminalSegment(target, previous, next)
  return true
}

export function createDictationLiveInserter(
  target: DictationInsertionTarget | null
): DictationLiveInserter {
  if (!target) {
    return {
      hasTarget: false,
      applyPartial: () => false,
      freezeSegment: () => false
    }
  }

  const state: MutableLiveState = {
    target,
    activeSegment: '',
    frozen: false,
    textAnchor: null
  }

  const apply = (next: string): boolean => {
    if (state.frozen) {
      if (!next.startsWith(state.activeSegment)) {
        return false
      }
      const extra = next.slice(state.activeSegment.length)
      if (extra) {
        insertText(extra, state.target)
      }
      state.activeSegment = next
      return true
    }
    const previous = state.activeSegment
    if (previous === next) {
      return true
    }
    // Why: Apple can emit an empty partial on a request seam. Applying that
    // would backspace the whole live line, which looks like the leftover
    // utterance vanished after the PTY wrapped.
    if (next === '' && previous !== '') {
      return true
    }
    const ok = applyToTarget(state, previous, next)
    if (!ok) {
      state.frozen = true
      return false
    }
    state.activeSegment = next
    return true
  }

  return {
    hasTarget: true,
    applyPartial: apply,
    freezeSegment: (text: string) => {
      const ok = apply(text)
      if (!ok) {
        return false
      }
      if (state.target.kind === 'text' && state.textAnchor !== null) {
        state.textAnchor += text.length
      }
      state.activeSegment = ''
      state.frozen = false
      return true
    }
  }
}
