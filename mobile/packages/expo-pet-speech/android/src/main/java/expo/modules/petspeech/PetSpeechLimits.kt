package expo.modules.petspeech

/**
 * Native pin of Orca `src/shared/pet-speak-limits.ts` `PET_SPEAK_MAX_TEXT_GRAPHEMES`.
 * Counted as Unicode code points (`String.codePointCount`), not Java `length` / UTF-16 units.
 */
object PetSpeechLimits {
    const val MAX_TEXT_CODE_POINTS = 2000
    const val MAX_EVENT_ID_CODE_POINTS = 128
}
