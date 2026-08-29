export const CANONICAL_LANGUAGES = ['yue-HK', 'zh-CN', 'zh-TW', 'en-US'] as const
export type CanonicalLanguage = (typeof CANONICAL_LANGUAGES)[number]

const LANGUAGE_MAP: Record<string, CanonicalLanguage> = {
  yue: 'yue-HK',
  cantonese: 'yue-HK',
  'yue-hk': 'yue-HK',
  'zh-hk': 'yue-HK',
  'zh-cn': 'zh-CN',
  'zh-tw': 'zh-TW',
  en: 'en-US',
  'en-us': 'en-US'
}

/**
 * Normalizes an incoming language tag to one of the canonical language IDs:
 * 'yue-HK' | 'zh-CN' | 'zh-TW' | 'en-US'.
 *
 * Returns undefined for missing, empty, unknown, or ambiguous tags.
 */
export function normalizePetLanguage(raw: unknown): CanonicalLanguage | undefined {
  if (typeof raw !== 'string') {
    return undefined
  }
  const trimmed = raw.trim().toLowerCase()
  if (!trimmed) {
    return undefined
  }
  return LANGUAGE_MAP[trimmed]
}
