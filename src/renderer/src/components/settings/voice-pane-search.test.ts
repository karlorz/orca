import { describe, expect, it } from 'vitest'
import { getVoicePaneSearchEntries } from './voice-pane-search'

describe('voice-pane-search', () => {
  it('associates Mac speech and Apple Speech keywords with Use Mac speech entry, not Speech Model entry', () => {
    const entries = getVoicePaneSearchEntries()
    const macSpeechEntry = entries.find((e) => e.title === 'Use Mac speech')
    const speechModelEntry = entries.find((e) => e.title === 'Speech Model')

    expect(macSpeechEntry).toBeDefined()
    expect(speechModelEntry).toBeDefined()

    expect(macSpeechEntry?.keywords).toContain('Mac speech')
    expect(macSpeechEntry?.keywords).toContain('Apple Speech')
    expect(macSpeechEntry?.keywords).toContain('system speech')

    expect(speechModelEntry?.keywords).not.toContain('Mac speech')
    expect(speechModelEntry?.keywords).not.toContain('Apple Speech')
    expect(speechModelEntry?.keywords).not.toContain('system speech')
  })
})
