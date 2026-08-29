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
    fun neverFallsBackToEnglishZhCnOrZhTwForCantonese() {
        val enUs = Locale.forLanguageTag("en-US")
        val zhCn = Locale.forLanguageTag("zh-CN")
        val zhTw = Locale.forLanguageTag("zh-TW")

        assertNull(PetSpeechLocaleResolver.resolveLocale("yue", setOf(enUs)))
        assertNull(PetSpeechLocaleResolver.resolveLocale("yue", setOf(zhCn)))
        assertNull(PetSpeechLocaleResolver.resolveLocale("yue", setOf(zhTw)))
        assertNull(PetSpeechLocaleResolver.resolveLocale("yue", emptySet()))
    }

    @Test
    fun resolvesZhCnStrictlyToZhCnOnly() {
        val zhCn = Locale.forLanguageTag("zh-CN")
        val zhTw = Locale.forLanguageTag("zh-TW")
        val zhHk = Locale.forLanguageTag("zh-HK")
        val yueHk = Locale.forLanguageTag("yue-HK")
        val enUs = Locale.forLanguageTag("en-US")

        val all = setOf(zhCn, zhTw, zhHk, yueHk, enUs)
        assertEquals(zhCn, PetSpeechLocaleResolver.resolveLocale("zh-CN", all))
        assertEquals(zhCn, PetSpeechLocaleResolver.resolveLocale("zh-cn", setOf(zhCn)))

        // Absence of zh-CN must not fall back to zh-TW, zh-HK, yue, or en
        assertNull(PetSpeechLocaleResolver.resolveLocale("zh-CN", setOf(zhTw, zhHk, yueHk, enUs)))
    }

    @Test
    fun resolvesZhTwStrictlyToZhTwOnly() {
        val zhCn = Locale.forLanguageTag("zh-CN")
        val zhTw = Locale.forLanguageTag("zh-TW")
        val zhHk = Locale.forLanguageTag("zh-HK")
        val yueHk = Locale.forLanguageTag("yue-HK")
        val enUs = Locale.forLanguageTag("en-US")

        val all = setOf(zhCn, zhTw, zhHk, yueHk, enUs)
        assertEquals(zhTw, PetSpeechLocaleResolver.resolveLocale("zh-TW", all))
        assertEquals(zhTw, PetSpeechLocaleResolver.resolveLocale("zh-tw", setOf(zhTw)))

        // Absence of zh-TW must not fall back to zh-CN, zh-HK, yue, or en
        assertNull(PetSpeechLocaleResolver.resolveLocale("zh-TW", setOf(zhCn, zhHk, yueHk, enUs)))
    }

    @Test
    fun resolvesEnUsToEnUsFirstThenOtherEnLocales() {
        val enUs = Locale.forLanguageTag("en-US")
        val enGb = Locale.forLanguageTag("en-GB")
        val enAu = Locale.forLanguageTag("en-AU")
        val zhCn = Locale.forLanguageTag("zh-CN")

        // Exact match preferred
        assertEquals(enUs, PetSpeechLocaleResolver.resolveLocale("en-US", setOf(enGb, enUs, enAu)))
        // Fallback to other en locale
        assertEquals(enGb, PetSpeechLocaleResolver.resolveLocale("en", setOf(enGb, zhCn)))
        assertEquals(enAu, PetSpeechLocaleResolver.resolveLocale("en-us", setOf(enAu, zhCn)))

        // Absence of any en locale returns null
        assertNull(PetSpeechLocaleResolver.resolveLocale("en-US", setOf(zhCn)))
    }

    @Test
    fun rejectsNonSupportedLanguages() {
        val yueHk = Locale.forLanguageTag("yue-HK")
        val zhHk = Locale.forLanguageTag("zh-HK")
        val frFr = Locale.forLanguageTag("fr-FR")
        val locales = setOf(yueHk, zhHk, frFr)

        assertNull(PetSpeechLocaleResolver.resolveLocale("fr-FR", locales))
        assertNull(PetSpeechLocaleResolver.resolveLocale("ja-JP", locales))
        assertNull(PetSpeechLocaleResolver.resolveLocale("unknown", locales))
    }

    @Test
    fun defaultsToCantoneseWhenRequestedLangIsNull() {
        val yueHk = Locale.forLanguageTag("yue-HK")
        val locales = setOf(yueHk)

        val resolved = PetSpeechLocaleResolver.resolveLocale(null, locales)
        assertEquals(yueHk, resolved)
    }
}
