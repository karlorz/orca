import { describe, expect, it } from 'vitest'
import { normalizePetLanguage, CANONICAL_LANGUAGES } from './pet-language-normalizer'

describe('mobile normalizePetLanguage', () => {
  it('round-trips all canonical language IDs', () => {
    expect(normalizePetLanguage('yue-HK')).toBe('yue-HK')
    expect(normalizePetLanguage('zh-CN')).toBe('zh-CN')
    expect(normalizePetLanguage('zh-TW')).toBe('zh-TW')
    expect(normalizePetLanguage('en-US')).toBe('en-US')
  })

  it('normalizes legacy Cantonese aliases to yue-HK', () => {
    expect(normalizePetLanguage('yue')).toBe('yue-HK')
    expect(normalizePetLanguage('cantonese')).toBe('yue-HK')
    expect(normalizePetLanguage('yue-hk')).toBe('yue-HK')
    expect(normalizePetLanguage('zh-hk')).toBe('yue-HK')
  })

  it('normalizes legacy English alias en to en-US', () => {
    expect(normalizePetLanguage('en')).toBe('en-US')
    expect(normalizePetLanguage('en-us')).toBe('en-US')
  })

  it('handles case-insensitivity and whitespace trimming', () => {
    expect(normalizePetLanguage('YUE-HK')).toBe('yue-HK')
    expect(normalizePetLanguage('ZH-cn')).toBe('zh-CN')
    expect(normalizePetLanguage('zh-tw')).toBe('zh-TW')
    expect(normalizePetLanguage('EN-us')).toBe('en-US')
    expect(normalizePetLanguage('CANTONESE')).toBe('yue-HK')
    expect(normalizePetLanguage('  yue-HK \n')).toBe('yue-HK')
    expect(normalizePetLanguage(' \t en ')).toBe('en-US')
    expect(normalizePetLanguage(' zh-CN ')).toBe('zh-CN')
    expect(normalizePetLanguage(' zh-TW ')).toBe('zh-TW')
  })

  it('rejects missing, empty, and non-string inputs', () => {
    expect(normalizePetLanguage(undefined)).toBeUndefined()
    expect(normalizePetLanguage(null)).toBeUndefined()
    expect(normalizePetLanguage('')).toBeUndefined()
    expect(normalizePetLanguage('   ')).toBeUndefined()
    expect(normalizePetLanguage(123)).toBeUndefined()
  })

  it('rejects unknown language tags', () => {
    expect(normalizePetLanguage('fr')).toBeUndefined()
    expect(normalizePetLanguage('fr-FR')).toBeUndefined()
    expect(normalizePetLanguage('ja')).toBeUndefined()
    expect(normalizePetLanguage('de')).toBeUndefined()
  })

  it('rejects ambiguous language tags (fail closed)', () => {
    expect(normalizePetLanguage('zh')).toBeUndefined()
    expect(normalizePetLanguage('mandarin')).toBeUndefined()
    expect(normalizePetLanguage('putonghua')).toBeUndefined()
    expect(normalizePetLanguage('cmn')).toBeUndefined()
    expect(normalizePetLanguage('taiwan')).toBeUndefined()
    expect(normalizePetLanguage('guoyu')).toBeUndefined()
    expect(normalizePetLanguage('english')).toBeUndefined()
    expect(normalizePetLanguage('en-gb')).toBeUndefined()
    expect(normalizePetLanguage('auto')).toBeUndefined()
  })

  it('exports the expected 4 canonical languages list', () => {
    expect(CANONICAL_LANGUAGES).toEqual(['yue-HK', 'zh-CN', 'zh-TW', 'en-US'])
  })
})
