package expo.modules.petspeech

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.util.Locale

class PetSpeechLocaleResolverTest {

    @Test
    fun prefersYueHkWhenAvailable() {
        val yueHk = Locale.forLanguageTag("yue-HK")
        val zhHk = Locale.forLanguageTag("zh-HK")
        val enUs = Locale.forLanguageTag("en-US")
        val locales = setOf(enUs, yueHk, zhHk)

        val resolved = PetSpeechLocaleResolver.resolveLocale("yue", locales)
        assertEquals(yueHk, resolved)
    }

    @Test
    fun fallsBackToZhHkWhenYueHkMissing() {
        val zhHk = Locale.forLanguageTag("zh-HK")
        val enUs = Locale.forLanguageTag("en-US")
        val zhCn = Locale.forLanguageTag("zh-CN")
        val locales = setOf(enUs, zhHk, zhCn)

        val resolved = PetSpeechLocaleResolver.resolveLocale("yue", locales)
        assertEquals(zhHk, resolved)
    }

    @Test
    fun failsClosedWhenNoCantoneseVoiceAvailable() {
        val enUs = Locale.forLanguageTag("en-US")
        val zhCn = Locale.forLanguageTag("zh-CN")
        val zhTw = Locale.forLanguageTag("zh-TW")
        val locales = setOf(enUs, zhCn, zhTw)

        val resolved = PetSpeechLocaleResolver.resolveLocale("yue", locales)
        assertNull(resolved)
    }

    @Test
    fun neverFallsBackToEnglishZhCnOrZhTw() {
        val enUs = Locale.forLanguageTag("en-US")
        val zhCn = Locale.forLanguageTag("zh-CN")
        val zhTw = Locale.forLanguageTag("zh-TW")

        assertNull(PetSpeechLocaleResolver.resolveLocale("yue", setOf(enUs)))
        assertNull(PetSpeechLocaleResolver.resolveLocale("yue", setOf(zhCn)))
        assertNull(PetSpeechLocaleResolver.resolveLocale("yue", setOf(zhTw)))
        assertNull(PetSpeechLocaleResolver.resolveLocale("yue", emptySet()))
    }

    @Test
    fun rejectsNonCantoneseRequestedLanguages() {
        val yueHk = Locale.forLanguageTag("yue-HK")
        val zhHk = Locale.forLanguageTag("zh-HK")
        val locales = setOf(yueHk, zhHk)

        assertNull(PetSpeechLocaleResolver.resolveLocale("en-US", locales))
        assertNull(PetSpeechLocaleResolver.resolveLocale("zh-CN", locales))
        assertNull(PetSpeechLocaleResolver.resolveLocale("zh-TW", locales))
        assertNull(PetSpeechLocaleResolver.resolveLocale("fr-FR", locales))
    }

    @Test
    fun defaultsToCantoneseWhenRequestedLangIsNull() {
        val yueHk = Locale.forLanguageTag("yue-HK")
        val locales = setOf(yueHk)

        val resolved = PetSpeechLocaleResolver.resolveLocale(null, locales)
        assertEquals(yueHk, resolved)
    }
}
