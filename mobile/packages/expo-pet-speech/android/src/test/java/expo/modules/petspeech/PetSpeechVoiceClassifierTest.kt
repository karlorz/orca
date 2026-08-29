package expo.modules.petspeech

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

class PetSpeechVoiceClassifierTest {

    @Test
    fun classifiesCantoneseLocales() {
        assertEquals("yue-HK", PetSpeechVoiceClassifier.classifyCanonicalLanguage(Locale.forLanguageTag("yue-HK")))
        assertEquals("yue-HK", PetSpeechVoiceClassifier.classifyCanonicalLanguage(Locale.forLanguageTag("yue")))
        assertEquals("yue-HK", PetSpeechVoiceClassifier.classifyCanonicalLanguage(Locale.forLanguageTag("zh-HK")))
        assertEquals("yue-HK", PetSpeechVoiceClassifier.classifyCanonicalLanguage(Locale("zh", "HK")))
        assertEquals("yue-HK", PetSpeechVoiceClassifier.classifyCanonicalLanguage(Locale("yue", "HK")))
    }

    @Test
    fun classifiesMainlandMandarinLocales() {
        assertEquals("zh-CN", PetSpeechVoiceClassifier.classifyCanonicalLanguage(Locale.forLanguageTag("zh-CN")))
        assertEquals("zh-CN", PetSpeechVoiceClassifier.classifyCanonicalLanguage(Locale("zh", "CN")))
    }

    @Test
    fun classifiesTaiwanMandarinLocales() {
        assertEquals("zh-TW", PetSpeechVoiceClassifier.classifyCanonicalLanguage(Locale.forLanguageTag("zh-TW")))
        assertEquals("zh-TW", PetSpeechVoiceClassifier.classifyCanonicalLanguage(Locale("zh", "TW")))
    }

    @Test
    fun classifiesEnglishLocales() {
        assertEquals("en-US", PetSpeechVoiceClassifier.classifyCanonicalLanguage(Locale.forLanguageTag("en-US")))
        assertEquals("en-US", PetSpeechVoiceClassifier.classifyCanonicalLanguage(Locale.US))
        assertEquals("en-US", PetSpeechVoiceClassifier.classifyCanonicalLanguage(Locale("en", "US")))
    }

    @Test
    fun rejectsUnsupportedOrAmbiguousLocales() {
        assertNull(PetSpeechVoiceClassifier.classifyCanonicalLanguage(null))
        assertNull(PetSpeechVoiceClassifier.classifyCanonicalLanguage(Locale.FRANCE))
        assertNull(PetSpeechVoiceClassifier.classifyCanonicalLanguage(Locale.JAPANESE))
        assertNull(PetSpeechVoiceClassifier.classifyCanonicalLanguage(Locale.GERMAN))
    }

    @Test
    fun testIsSupportedVoiceLocale() {
        assertTrue(PetSpeechVoiceClassifier.isSupportedVoiceLocale(Locale.forLanguageTag("yue-HK")))
        assertTrue(PetSpeechVoiceClassifier.isSupportedVoiceLocale(Locale.forLanguageTag("zh-CN")))
        assertTrue(PetSpeechVoiceClassifier.isSupportedVoiceLocale(Locale.forLanguageTag("zh-TW")))
        assertTrue(PetSpeechVoiceClassifier.isSupportedVoiceLocale(Locale.forLanguageTag("en-US")))
        assertFalse(PetSpeechVoiceClassifier.isSupportedVoiceLocale(Locale.FRENCH))
    }
}
