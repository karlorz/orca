/** Refuse input unless the captured Grok questionnaire navigation footer owns the keyboard. */
export function verifyGrokQuestionNavigationScreen(
  lines: readonly string[],
  content?: { question: string; optionLabels: readonly string[] }
): void {
  const screen = lines.join('\n')
  if (
    !screen.includes('↑/↓ navigate · y copy') ||
    !screen.includes('Enter:submit') ||
    !screen.includes('Tab:next answer')
  ) {
    throw new Error('question_keyboard_unverifiable')
  }
  if (!content) {
    return
  }
  const compact = screen.replace(/\s+/g, ' ')
  const questionNeedle = content.question.trim().replace(/\s+/g, ' ').slice(0, 48)
  if (!questionNeedle || !compact.includes(questionNeedle)) {
    throw new Error('question_progress_unverifiable')
  }
  for (const label of content.optionLabels) {
    const needle = label.trim().replace(/\s+/g, ' ').slice(0, 24)
    if (!needle || !compact.includes(needle)) {
      throw new Error('question_choice_changed')
    }
  }
}
