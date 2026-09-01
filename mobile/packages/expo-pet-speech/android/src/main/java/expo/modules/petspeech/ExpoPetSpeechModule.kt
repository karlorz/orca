package expo.modules.petspeech

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.util.Locale
import java.util.UUID

class ExpoPetSpeechModule : Module() {

    private val mainHandler = Handler(Looper.getMainLooper())
    private val initLock = Any()
    private var isDestroyed = false

    private val resourceOwnerRegistry = PetSpeechResourceOwnerRegistry()
    private val karaokeHandler = Handler(Looper.getMainLooper())

    override fun definition() = ModuleDefinition {
        Name("ExpoPetSpeech")

        Events("onCaptionRange")

        AsyncFunction("getAvailableVoicesAsync") { promise: Promise ->
            synchronized(initLock) {
                if (isDestroyed) {
                    promise.resolve(emptyList<Map<String, Any>>())
                    return@AsyncFunction
                }
            }

            val context = appContext.reactContext
            if (context == null) {
                promise.resolve(emptyList<Map<String, Any>>())
                return@AsyncFunction
            }

            createTtsEngine(context) { engineLifecycle ->
                if (engineLifecycle == null) {
                    promise.resolve(emptyList<Map<String, Any>>())
                    return@createTtsEngine
                }
                try {
                    val voices = engineLifecycle.engine.voices
                    val defaultEngine = engineLifecycle.engine.defaultEngine ?: ""
                    if (voices != null) {
                        val filteredVoices = voices
                            .filter { voice ->
                                PetSpeechVoiceClassifier.isSupportedVoiceLocale(voice.locale)
                            }
                            .map { voice ->
                                val name = voice.name ?: ""
                                val canonicalLanguage = PetSpeechVoiceClassifier.classifyCanonicalLanguage(voice.locale) ?: ""
                                val lowerName = name.lowercase()
                                val gender = when {
                                    lowerName.contains("女") ||
                                    lowerName.contains("female") ||
                                    lowerName.contains("hiu") ||
                                    lowerName.contains("yuc") ||
                                    lowerName.contains("gaai") -> "female"
                                    lowerName.contains("男") ||
                                    lowerName.contains("male") -> "male"
                                    else -> "unknown"
                                }
                                mapOf(
                                    "name" to name,
                                    "locale" to (voice.locale?.toLanguageTag() ?: ""),
                                    "language" to canonicalLanguage,
                                    "quality" to voice.quality,
                                    "network" to voice.isNetworkConnectionRequired,
                                    "engine" to defaultEngine,
                                    "gender" to gender
                                )
                            }
                        promise.resolve(filteredVoices)
                    } else {
                        promise.resolve(emptyList<Map<String, Any>>())
                    }
                } catch (_: Exception) {
                    promise.resolve(emptyList<Map<String, Any>>())
                } finally {
                    engineLifecycle.release()
                }
            }
        }

        AsyncFunction("speakAsync") { options: Map<String, Any?>, promise: Promise ->
            synchronized(initLock) {
                if (isDestroyed) {
                    promise.resolve(mapOf("outcome" to "cancelled"))
                    return@AsyncFunction
                }
            }

            val eventId = options["eventId"] as? String
            val text = options["text"] as? String
            val lang = options["lang"] as? String
            val voiceName = options["voiceName"] as? String
            val debug = options["debug"] as? Boolean ?: false

            if (!PetSpeechPayloadValidator.isValid(eventId, text, lang)) {
                promise.resolve(mapOf("outcome" to "playback-error"))
                return@AsyncFunction
            }

            val validEventId = eventId!!.trim()
            val validText = text!!.trim()
            val rate = PetSpeechRate.parse(options["rate"])
            val playerKindParam = options["playerKind"] as? String
            val playerKind = PetSpeechPlayerKind.fromIdentifier(playerKindParam)

            val context = appContext.reactContext
            if (context == null) {
                promise.resolve(mapOf("outcome" to "playback-error"))
                return@AsyncFunction
            }

            val tempFile = File(context.cacheDir, "pet_speech_${UUID.randomUUID()}.wav")
            val tempFilePath = tempFile.absolutePath

            // Establish resource owner synchronously before TTS initialization
            val owner = resourceOwnerRegistry.createOwner(
                validEventId,
                validText,
                tempFilePath,
                onOutcome = { outcome ->
                    promise.resolve(mapOf("outcome" to outcome.name))
                },
                onDeleteFile = { path ->
                    if (debug) {
                        try {
                            val lastWavFile = File(context.cacheDir, "pet_speech_last.wav")
                            val srcFile = File(path)
                            if (srcFile.exists()) {
                                srcFile.copyTo(lastWavFile, overwrite = true)
                                android.util.Log.i("PetSpeechDebug", "copied last wav to ${lastWavFile.absolutePath}")
                            }
                        } catch (e: Exception) {
                            android.util.Log.i("PetSpeechDebug", "failed copying debug wav: ${e.message}")
                        }
                    }
                    try {
                        val file = File(path)
                        if (file.exists()) {
                            file.delete()
                        }
                    } catch (_: Exception) {}
                }
            )

            createTtsEngine(context) { engineLifecycle ->
                synchronized(initLock) {
                    if (isDestroyed) {
                        engineLifecycle?.release()
                        owner.teardown()
                        return@createTtsEngine
                    }
                }

                if (engineLifecycle == null) {
                    owner.settle(PetSpeechOutcome.PlaybackError)
                    return@createTtsEngine
                }

                // Attach engine lifecycle to owner. If owner was superseded/cancelled in the meantime,
                // attachEngineLifecycle will release engineLifecycle and return false.
                if (!owner.attachEngineLifecycle(engineLifecycle)) {
                    return@createTtsEngine
                }

                val tts = engineLifecycle.engine

                try {
                    val availableLocales = tts.voices?.map { it.locale }?.toSet() ?: emptySet()
                    val targetLocale = PetSpeechLocaleResolver.resolveLocale(lang, availableLocales)

                    if (targetLocale == null) {
                        owner.settle(PetSpeechOutcome.VoiceUnavailable)
                        return@createTtsEngine
                    }

                    val langResult = tts.setLanguage(targetLocale)
                    if (!PetSpeechTtsLanguageClassifier.isLanguageAvailable(langResult)) {
                        owner.settle(PetSpeechOutcome.VoiceUnavailable)
                        return@createTtsEngine
                    }

                    var matchingVoiceFound = false
                    var setVoiceResult: Int? = null
                    var exceptionThrown = false

                    if (!voiceName.isNullOrBlank()) {
                        val matchingVoice = tts.voices?.find { it.name == voiceName.trim() }
                        matchingVoiceFound = matchingVoice != null
                        if (matchingVoice != null) {
                            try {
                                setVoiceResult = tts.setVoice(matchingVoice)
                            } catch (_: Exception) {
                                exceptionThrown = true
                            }
                        }
                    }

                    var readbackVoiceName: String? = null
                    var readbackNetwork = false
                    try {
                        val currentVoice = tts.voice
                        readbackVoiceName = currentVoice?.name
                        readbackNetwork = currentVoice?.isNetworkConnectionRequired ?: false
                    } catch (_: Exception) {
                        exceptionThrown = true
                    }

                    val decision = PetSpeechVoiceApplicationClassifier.evaluateVoiceApplication(
                        requestedVoiceName = voiceName,
                        matchingVoiceFound = matchingVoiceFound,
                        setVoiceResult = setVoiceResult,
                        readbackVoiceName = readbackVoiceName,
                        readbackNetwork = readbackNetwork,
                        exceptionThrown = exceptionThrown
                    )

                    val defaultEngine = tts.defaultEngine ?: ""
                    android.util.Log.i(
                        "PetSpeechDebug",
                        "speakAsync eventId=$validEventId requestedVoiceName=$voiceName appliedVoiceName=${decision.effectiveVoiceName} setVoiceResult=$setVoiceResult locale=${targetLocale.toLanguageTag()} engine=$defaultEngine rate=$rate networkVoice=${decision.networkRequired} filePath=$tempFilePath durationMs=-1 teardown=reset-stop-release"
                    )

                    if (!decision.shouldProceed) {
                        android.util.Log.w(
                            "PetSpeechDebug",
                            "speakAsync voice application failed eventId=$validEventId requestedVoiceName=$voiceName appliedVoiceName=${decision.effectiveVoiceName} setVoiceResult=$setVoiceResult matchingVoiceFound=$matchingVoiceFound exceptionThrown=$exceptionThrown"
                        )
                        owner.settle(decision.failureOutcome ?: PetSpeechOutcome.VoiceUnavailable)
                        return@createTtsEngine
                    }

                    // synthesizeToFile often ignores setSpeechRate (especially CJK engines).
                    // Keep engine rate at 1.0 and apply the pet multiplier during MediaPlayer playback.
                    tts.setSpeechRate(1.0f)

                    val utteranceId = "utterance_${owner.id}_$validEventId"
                    var karaokeSampleRate = 0
                    val karaokeRaw = java.util.Collections.synchronizedList(mutableListOf<IntArray>())

                    tts.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                        override fun onStart(id: String?) {}

                        override fun onBeginSynthesis(
                            id: String?,
                            sampleRateInHz: Int,
                            audioFormat: Int,
                            channelCount: Int
                        ) {
                            if (id == utteranceId) {
                                karaokeSampleRate = sampleRateInHz
                            }
                        }

                        override fun onRangeStart(id: String?, start: Int, end: Int, frame: Int) {
                            if (id == utteranceId) {
                                karaokeRaw.add(intArrayOf(start, end, frame))
                            }
                        }

                        override fun onDone(id: String?) {
                            if (id == utteranceId && resourceOwnerRegistry.isCurrent(owner)) {
                                engineLifecycle.onSynthesisComplete()
                                PetSpeechPlaybackInstrumentation.recordSynthesisCompleted(validEventId)
                                val ranges = karaokeRaw.map { raw ->
                                    PetSpeechCaptionRange(
                                        start = raw[0],
                                        end = raw[1],
                                        startMs = PetSpeechKaraoke.startMs(raw[2], karaokeSampleRate)
                                    )
                                }
                                mainHandler.post {
                                    if (resourceOwnerRegistry.isCurrent(owner)) {
                                        startServicePlayback(
                                            context,
                                            owner,
                                            validEventId,
                                            validText,
                                            tempFilePath,
                                            rate,
                                            debug,
                                            playerKind,
                                            ranges
                                        )
                                    } else {
                                        owner.teardown()
                                    }
                                }
                            }
                        }

                        override fun onStop(id: String?, interrupted: Boolean) {
                            if (id == utteranceId) {
                                engineLifecycle.onCancelled()
                                owner.settle(PetSpeechOutcome.Cancelled)
                            }
                        }

                        @Deprecated("Deprecated in Java")
                        override fun onError(id: String?) {
                            if (id == utteranceId) {
                                engineLifecycle.onSynthesisFailed()
                                owner.settle(PetSpeechOutcome.PlaybackError)
                            }
                        }

                        override fun onError(id: String?, errorCode: Int) {
                            if (id == utteranceId) {
                                engineLifecycle.onSynthesisFailed()
                                owner.settle(PetSpeechOutcome.PlaybackError)
                            }
                        }
                    })

                    val params = Bundle()
                    val result = tts.synthesizeToFile(validText, params, tempFile, utteranceId)
                    if (result != TextToSpeech.SUCCESS) {
                        engineLifecycle.onSynthesisFailed()
                        owner.settle(PetSpeechOutcome.PlaybackError)
                    }
                } catch (e: Exception) {
                    owner.settle(PetSpeechOutcome.PlaybackError)
                }
            }
        }

        AsyncFunction("stopAsync") { promise: Promise ->
            try {
                clearCaptionKaraoke()
                resourceOwnerRegistry.stopAll()
                promise.resolve(null)
            } catch (_: Exception) {
                promise.resolve(null)
            }
        }

        AsyncFunction("acquireVoiceSessionAsync") { promise: Promise ->
            val context = appContext.reactContext
            if (context == null) {
                promise.resolve(mapOf("held" to false))
                return@AsyncFunction
            }

            try {
                val startIntent = Intent(context, PetSpeechForegroundService::class.java).apply {
                    action = PetSpeechForegroundService.ACTION_HOLD_SESSION
                    putExtra(PetSpeechForegroundService.EXTRA_TEXT, PetSpeechForegroundStart.IDLE_NOTIFICATION_TEXT)
                }

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(startIntent)
                } else {
                    context.startService(startIntent)
                }
                PetSpeechBatteryExemptionPromptHelper.promptBatteryExemptionOnce(context)
                promise.resolve(mapOf("held" to true))
            } catch (e: Exception) {
                if (PetSpeechForegroundStart.isForegroundServiceStartNotAllowed(e)) {
                    promise.resolve(mapOf("held" to false))
                } else {
                    promise.resolve(mapOf("held" to false))
                }
            }
        }

        AsyncFunction("releaseVoiceSessionAsync") { promise: Promise ->
            val context = appContext.reactContext
            if (context != null) {
                try {
                    val stopIntent = Intent(context, PetSpeechForegroundService::class.java).apply {
                        action = PetSpeechForegroundService.ACTION_RELEASE_SESSION
                    }
                    context.startService(stopIntent)
                } catch (_: Exception) {}
            }
            promise.resolve(null)
        }

        AsyncFunction("updateVoiceSessionNotificationAsync") { text: String, promise: Promise ->
            val context = appContext.reactContext
            if (context != null) {
                try {
                    val updateIntent = Intent(context, PetSpeechForegroundService::class.java).apply {
                        action = PetSpeechForegroundService.ACTION_UPDATE_HELD_NOTIFICATION
                        putExtra(PetSpeechForegroundService.EXTRA_TEXT, text)
                    }
                    context.startService(updateIntent)
                } catch (_: Exception) {}
            }
            promise.resolve(null)
        }

        OnDestroy {
            synchronized(initLock) {
                isDestroyed = true
            }
            try {
                clearCaptionKaraoke()
                resourceOwnerRegistry.stopAll()
            } catch (_: Exception) {}
        }
    }

    private fun createTtsEngine(
        context: Context,
        onReady: (PetSpeechEngineLifecycle<TextToSpeech>?) -> Unit
    ) {
        var ttsInstance: TextToSpeech? = null
        var lifecycle: PetSpeechEngineLifecycle<TextToSpeech>? = null

        ttsInstance = TextToSpeech(context) { status ->
            synchronized(initLock) {
                if (isDestroyed) {
                    try {
                        ttsInstance?.shutdown()
                    } catch (_: Exception) {}
                    onReady(null)
                    return@TextToSpeech
                }

                if (status == TextToSpeech.SUCCESS && ttsInstance != null) {
                    val safeTts = ttsInstance!!
                    lifecycle = PetSpeechEngineLifecycle(
                        engine = safeTts,
                        onStop = {
                            try {
                                it.stop()
                            } catch (_: Exception) {}
                        },
                        onShutdown = {
                            try {
                                it.shutdown()
                            } catch (_: Exception) {}
                        }
                    )
                    onReady(lifecycle)
                } else {
                    try {
                        ttsInstance?.shutdown()
                    } catch (_: Exception) {}
                    onReady(null)
                }
            }
        }
    }

    private fun clearCaptionKaraoke() {
        karaokeHandler.removeCallbacksAndMessages(null)
    }

    private fun scheduleCaptionKaraoke(
        eventId: String,
        ranges: List<PetSpeechCaptionRange>,
        rate: Float
    ) {
        clearCaptionKaraoke()
        for (range in ranges) {
            if (range.end <= range.start) {
                continue
            }
            val delay = PetSpeechKaraoke.wallDelayMs(range.startMs, rate)
            karaokeHandler.postDelayed({
                sendEvent(
                    "onCaptionRange",
                    mapOf(
                        "eventId" to eventId,
                        "start" to range.start,
                        "end" to range.end
                    )
                )
            }, delay)
        }
    }

    private fun startServicePlayback(
        context: Context,
        owner: PetSpeechResourceOwner,
        eventId: String,
        text: String,
        tempFilePath: String,
        rate: Float,
        debug: Boolean = false,
        playerKind: PetSpeechPlayerKind = PetSpeechPlayerProvider.defaultPlayerKind,
        karaokeRanges: List<PetSpeechCaptionRange> = emptyList()
    ) {
        val startIntent = Intent(context, PetSpeechForegroundService::class.java).apply {
            putExtra(PetSpeechForegroundService.EXTRA_OWNER_ID, owner.id)
            putExtra(PetSpeechForegroundService.EXTRA_TEXT, text)
        }

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(startIntent)
            } else {
                context.startService(startIntent)
            }

            owner.markServiceStarted {
                mainHandler.post {
                    try {
                        val stopIntent = Intent(context, PetSpeechForegroundService::class.java).apply {
                            action = PetSpeechForegroundService.ACTION_STOP_OWNER
                            putExtra(PetSpeechForegroundService.EXTRA_OWNER_ID, owner.id)
                        }
                        context.startService(stopIntent)
                    } catch (_: Exception) {}
                }
            }

            val bindIntent = Intent(context, PetSpeechForegroundService::class.java)
            val connection = object : ServiceConnection {
                override fun onServiceConnected(name: ComponentName?, service: IBinder?) {
                    if (!resourceOwnerRegistry.isCurrent(owner)) {
                        try {
                            context.unbindService(this)
                        } catch (_: Exception) {}
                        return
                    }

                    val binder = service as? PetSpeechForegroundService.LocalBinder
                    val foregroundService = binder?.getService()
                    if (foregroundService == null) {
                        try {
                            context.unbindService(this)
                        } catch (_: Exception) {}
                        owner.onServiceConnectFailed()
                        return
                    }

                    owner.attachBoundService {
                        mainHandler.post {
                            try {
                                foregroundService.cancelSpeech(owner.id)
                            } catch (_: Exception) {}
                        }
                    }

                    foregroundService.playSpeech(
                        owner.id,
                        eventId,
                        text,
                        tempFilePath,
                        rate,
                        debug,
                        playerKind,
                        { _, outcome ->
                            clearCaptionKaraoke()
                            owner.settle(outcome)
                        },
                        onPlaybackStarted = {
                            scheduleCaptionKaraoke(eventId, karaokeRanges, rate)
                        }
                    )
                }

                override fun onServiceDisconnected(name: ComponentName?) {
                    if (resourceOwnerRegistry.isCurrent(owner)) {
                        owner.onServiceDisconnected()
                    }
                }
            }

            owner.registerConnectionAttempt(connection) {
                mainHandler.post {
                    try {
                        context.unbindService(connection)
                    } catch (_: Exception) {}
                }
            }

            val bound = context.bindService(bindIntent, connection, Context.BIND_AUTO_CREATE)
            owner.onBindResult(bound)
        } catch (e: Exception) {
            owner.onBindFailed()
        }
    }
}
