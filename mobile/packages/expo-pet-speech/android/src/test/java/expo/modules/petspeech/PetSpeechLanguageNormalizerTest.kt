package expo.modules.petspeech

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PetSpeechLanguageNormalizerTest {

    @Test
    fun roundTripsAllCanonicalLanguageIDs() {
        assertEquals("yue-HK", PetSpeechLanguageNormalizer.normalize("yue-HK"))
        assertEquals("zh-CN", PetSpeechLanguageNormalizer.normalize("zh-CN"))
        assertEquals("zh-TW", PetSpeechLanguageNormalizer.normalize("zh-TW"))
        assertEquals("en-US", PetSpeechLanguageNormalizer.normalize("en-US"))
    }

    @Test
    fun normalizesLegacyCantoneseAliasesToYueHk() {
        assertEquals("yue-HK", PetSpeechLanguageNormalizer.normalize("yue"))
        assertEquals("yue-HK", PetSpeechLanguageNormalizer.normalize("cantonese"))
        assertEquals("yue-HK", PetSpeechLanguageNormalizer.normalize("yue-hk"))
        assertEquals("yue-HK", PetSpeechLanguageNormalizer.normalize("zh-hk"))
    }

    @Test
    fun normalizesLegacyEnglishAliasEnToEnUs() {
        assertEquals("en-US", PetSpeechLanguageNormalizer.normalize("en"))
        assertEquals("en-US", PetSpeechLanguageNormalizer.normalize("en-us"))
    }

    @Test
    fun handlesCaseInsensitivityAndWhitespaceTrimming() {
        assertEquals("yue-HK", PetSpeechLanguageNormalizer.normalize("YUE-HK"))
        assertEquals("zh-CN", PetSpeechLanguageNormalizer.normalize("ZH-cn"))
        assertEquals("zh-TW", PetSpeechLanguageNormalizer.normalize("zh-tw"))
        assertEquals("en-US", PetSpeechLanguageNormalizer.normalize("EN-us"))
        assertEquals("yue-HK", PetSpeechLanguageNormalizer.normalize("CANTONESE"))
        assertEquals("yue-HK", PetSpeechLanguageNormalizer.normalize("  yue-HK \n"))
        assertEquals("en-US", PetSpeechLanguageNormalizer.normalize(" \t en "))
        assertEquals("zh-CN", PetSpeechLanguageNormalizer.normalize(" zh-CN "))
        assertEquals("zh-TW", PetSpeechLanguageNormalizer.normalize(" zh-TW "))
    }

    @Test
    fun rejectsMissingAndEmptyInputs() {
        assertNull(PetSpeechLanguageNormalizer.normalize(null))
        assertNull(PetSpeechLanguageNormalizer.normalize(""))
        assertNull(PetSpeechLanguageNormalizer.normalize("   "))
    }

    @Test
    fun rejectsUnknownLanguageTags() {
        assertNull(PetSpeechLanguageNormalizer.normalize("fr"))
        assertNull(PetSpeechLanguageNormalizer.normalize("fr-FR"))
        assertNull(PetSpeechLanguageNormalizer.normalize("ja"))
        assertNull(PetSpeechLanguageNormalizer.normalize("de"))
    }

    @Test
    fun rejectsAmbiguousLanguageTags() {
        assertNull(PetSpeechLanguageNormalizer.normalize("zh"))
        assertNull(PetSpeechLanguageNormalizer.normalize("mandarin"))
        assertNull(PetSpeechLanguageNormalizer.normalize("putonghua"))
        assertNull(PetSpeechLanguageNormalizer.normalize("cmn"))
        assertNull(PetSpeechLanguageNormalizer.normalize("taiwan"))
        assertNull(PetSpeechLanguageNormalizer.normalize("guoyu"))
        assertNull(PetSpeechLanguageNormalizer.normalize("english"))
        assertNull(PetSpeechLanguageNormalizer.normalize("en-gb"))
        assertNull(PetSpeechLanguageNormalizer.normalize("auto"))
    }

    @Test
    fun exportsExpectedCanonicalLanguagesList() {
        assertEquals(
            listOf("yue-HK", "zh-CN", "zh-TW", "en-US"),
            PetSpeechLanguageNormalizer.CANONICAL_LANGUAGES
        )
    }
}
