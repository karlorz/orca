export type CaptionSentence = {
  text: string
  start: number
  end: number
}

// Trailing closers: 」 』 " ' ) ]
const TRAILING_CLOSERS = new Set(['」', '』', '"', "'", ')', ']'])
// Fullwidth punctuation that always ends a sentence: 。 ！？
const FULLWIDTH_TERMINATORS = new Set(['。', '！', '？'])
// ASCII terminators: . ! ? (only if followed by whitespace or end of string)
const ASCII_TERMINATORS = new Set(['.', '!', '?'])

/**
 * Split caption text into sentences.
 *
 * Rules:
 * - Split on fullwidth `。！？` and newlines unconditionally.
 * - Split on ASCII `. ! ?` only when followed by whitespace or end of text.
 * - Trailing closers `」』"')]` attach to the current sentence.
 * - Do NOT split on `…`.
 * - Offsets `start` and `end` match UTF-16 JavaScript string indices to remain
 *   consistent with `splitCaptionHighlight` and Expo/speech range producers.
 */
export function splitCaptionSentences(text: string): CaptionSentence[] {
  if (!text) {
    return []
  }

  const sentences: CaptionSentence[] = []
  const len = text.length
  let currentStart = 0
  let i = 0

  while (i < len) {
    const ch = text[i]

    // Check newlines: \r\n or \n or \r
    if (ch === '\r' || ch === '\n') {
      const sentenceText = text.slice(currentStart, i).trim()
      if (sentenceText) {
        sentences.push({
          text: sentenceText,
          start: currentStart,
          end: i
        })
      }
      if (ch === '\r' && i + 1 < len && text[i + 1] === '\n') {
        i += 2
      } else {
        i += 1
      }
      // Skip any leading whitespace for next sentence
      while (
        i < len &&
        (text[i] === ' ' || text[i] === '\t' || text[i] === '\r' || text[i] === '\n')
      ) {
        i++
      }
      currentStart = i
      continue
    }

    let isTerminator = false
    if (FULLWIDTH_TERMINATORS.has(ch)) {
      isTerminator = true
    } else if (ASCII_TERMINATORS.has(ch)) {
      // Check if next char is whitespace or end of text
      const nextChar = i + 1 < len ? text[i + 1] : undefined
      if (
        nextChar === undefined ||
        nextChar === ' ' ||
        nextChar === '\t' ||
        nextChar === '\r' ||
        nextChar === '\n'
      ) {
        isTerminator = true
      }
    }

    if (isTerminator) {
      i++
      // Consume any trailing closers or terminators (e.g. ?)。
      while (i < len && (TRAILING_CLOSERS.has(text[i]) || FULLWIDTH_TERMINATORS.has(text[i]))) {
        i++
      }
      const sentenceText = text.slice(currentStart, i)
      if (sentenceText.trim()) {
        sentences.push({
          text: sentenceText,
          start: currentStart,
          end: i
        })
      }
      // Skip spaces following terminator
      while (i < len && (text[i] === ' ' || text[i] === '\t')) {
        i++
      }
      currentStart = i
      continue
    }

    i++
  }

  if (currentStart < len) {
    const trailing = text.slice(currentStart).trim()
    if (trailing) {
      sentences.push({
        text: trailing,
        start: currentStart,
        end: len
      })
    }
  }

  return sentences
}

/**
 * Find the sentence containing the active karaoke highlight range.
 * If range is null/undefined or outside, defaults to first sentence (index 0).
 * Highlight at the last code point of sentence 1 still shows sentence 1;
 * the first highlight strictly past sentence 1 shows sentence 2.
 */
export function findActiveSentenceIndex(
  sentences: CaptionSentence[],
  range?: { start: number; end: number } | null
): number {
  if (sentences.length <= 1 || !range) {
    return 0
  }
  const pos = range.start
  for (let idx = 0; idx < sentences.length; idx++) {
    const s = sentences[idx]
    if (pos >= s.start && pos < s.end) {
      return idx
    }
  }
  if (pos >= sentences[sentences.length - 1].end) {
    return sentences.length - 1
  }
  return 0
}
