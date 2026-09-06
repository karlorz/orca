import { computeLiveTranscriptDelta } from '../../../src/shared/dictation-live-delta'
import { joinTranscriptSegments } from '../../../src/shared/dictation-segment-format'

export type MobileLivePtyResult = {
  deleteGraphemes: number
  insertText: string
  payload: string | null
  spoken: string
}

export function resolveMobileLiveSpoken(args: {
  committedText?: string
  partialText?: string
  previousSpoken: string
}): string {
  const nextSpoken = joinTranscriptSegments([args.committedText ?? '', args.partialText ?? ''])
  // Why: Apple Speech can emit an empty partial during seam handoffs;
  // ignore empty spoken if previous spoken was non-empty to avoid backspacing.
  if (!nextSpoken.trim() && args.previousSpoken) {
    return args.previousSpoken
  }
  return nextSpoken
}

export function computeMobileLivePtyPayload(args: {
  previousSpoken: string
  nextSpoken: string
  applyFullRewrite?: boolean
}): MobileLivePtyResult {
  const { previousSpoken, nextSpoken, applyFullRewrite = false } = args
  if (previousSpoken === nextSpoken) {
    return {
      deleteGraphemes: 0,
      insertText: '',
      payload: null,
      spoken: previousSpoken
    }
  }

  const delta = computeLiveTranscriptDelta(previousSpoken, nextSpoken)

  // Why: If keepLength is 0 and previous was non-empty, backspacing the full
  // length without a terminal buffer to cap it can wipe prompts or typed text.
  // Finals may still need a full rewrite so punctuation lands.
  if (delta.keepLength === 0 && previousSpoken.length > 0 && !applyFullRewrite) {
    return {
      deleteGraphemes: 0,
      insertText: '',
      payload: null,
      spoken: previousSpoken
    }
  }

  const payload = `${'\x7f'.repeat(delta.deleteGraphemes)}${delta.insertText}`
  return {
    deleteGraphemes: delta.deleteGraphemes,
    insertText: delta.insertText,
    payload: payload || null,
    spoken: nextSpoken
  }
}

export function computeMobileLiveComposerValue(args: { baseline: string; spoken: string }): string {
  return `${args.baseline}${args.spoken}`
}

const mobilePtyChains = new Map<string, Promise<void>>()

export function enqueueMobilePtySend(key: string, job: () => Promise<void>): Promise<void> {
  const next = (mobilePtyChains.get(key) ?? Promise.resolve()).then(job, job)
  const settled = next.then(
    () => undefined,
    () => undefined
  )
  mobilePtyChains.set(key, settled)
  void settled.then(() => {
    if (mobilePtyChains.get(key) === settled) {
      mobilePtyChains.delete(key)
    }
  })
  return next
}
