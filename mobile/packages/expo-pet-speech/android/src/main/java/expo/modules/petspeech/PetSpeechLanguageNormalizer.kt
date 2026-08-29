package expo.modules.petspeech

import java.util.Locale

object PetSpeechLanguageNormalizer {
    const val CANONICAL_YUE_HK = "yue-HK"
    const val CANONICAL_ZH_CN = "zh-CN"
    const val CANONICAL_ZH_TW = "zh-TW"
    const val CANONICAL_EN_US = "en-US"

    val CANONICAL_LANGUAGES = listOf(
        CANONICAL_YUE_HK,
        CANONICAL_ZH_CN,
        CANONICAL_ZH_TW,
        CANONICAL_EN_US
    )

    private val LANGUAGE_MAP = mapOf(
        "yue" to CANONICAL_YUE_HK,
        "cantonese" to CANONICAL_YUE_HK,
        "yue-hk" to CANONICAL_YUE_HK,
        "zh-hk" to CANONICAL_YUE_HK,
        "zh-cn" to CANONICAL_ZH_CN,
        "zh-tw" to CANONICAL_ZH_TW,
        "en" to CANONICAL_EN_US,
        "en-us" to CANONICAL_EN_US
    )

    /**
     * Normalizes an incoming language tag to one of the canonical language IDs:
     * "yue-HK", "zh-CN", "zh-TW", "en-US".
     *
     * Returns null for missing, empty, unknown, or ambiguous tags.
     */
    fun normalize(raw: String?): String? {
        if (raw == null) {
            return null
        }
        val trimmed = raw.trim().lowercase(Locale.ROOT)
        if (trimmed.isEmpty()) {
            return null
        }
        return LANGUAGE_MAP[trimmed]
    }
}
