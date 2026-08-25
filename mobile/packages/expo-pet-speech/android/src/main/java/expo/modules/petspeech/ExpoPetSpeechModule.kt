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

    override fun definition() = ModuleDefinition {
        Name("ExpoPetSpeech")

        AsyncFunction("getAvailableVoicesAsync") { promise: Promise ->
            synchronized(initLock) {
                if (isDestroyed) {
                    promise.resolve(emptyList<String>())
                    return@AsyncFunction
                }
            }

            val context = appContext.reactContext
            if (context == null) {
                promise.resolve(emptyList<String>())
                return@AsyncFunction
            }

            createTtsEngine(context) { engineLifecycle ->
                if (engineLifecycle == null) {
                    promise.resolve(emptyList<String>())
                    return@createTtsEngine
                }
                try {
                    val voices = engineLifecycle.engine.voices
                    if (voices != null) {
                        val languages = voices.map { it.locale.toLanguageTag() }.distinct()
                        promise.resolve(languages)
                    } else {
                        promise.resolve(emptyList<String>())
                    }
                } catch (_: Exception) {
                    promise.resolve(emptyList<String>())
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

            if (!PetSpeechPayloadValidator.isValid(eventId, text, lang)) {
                promise.resolve(mapOf("outcome" to "playback-error"))
                return@AsyncFunction
            }

            val validEventId = eventId!!.trim()
            val validText = text!!.trim()

            val context = appContext.reactContext
            if (context == null) {
                promise.resolve(mapOf("outcome" to "playback-error"))
                return@AsyncFunction
            }

            val tempFile = File(context.cacheDir, "pet_speech_${UUID.randomUUID()}.wav")
            val tempFilePath = tempFile.absolutePath

            // Establish resource owner synchronously before TTS initialization
            val owner = resourceOwnerRegistry.createOwner(validEventId, validText, tempFilePath) { outcome ->
                promise.resolve(mapOf("outcome" to outcome.name))
            }

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

                    val rate = PetSpeechRate.parse(options["rate"])
                    if (tts.setSpeechRate(rate) == TextToSpeech.ERROR) {
                        tts.setSpeechRate(PetSpeechRate.DEFAULT)
                    }

                    val utteranceId = "utterance_${owner.id}_$validEventId"

                    tts.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                        override fun onStart(id: String?) {}

                        override fun onDone(id: String?) {
                            if (id == utteranceId && resourceOwnerRegistry.isCurrent(owner)) {
                                engineLifecycle.onSynthesisComplete()
                                mainHandler.post {
                                    if (resourceOwnerRegistry.isCurrent(owner)) {
                                        startServicePlayback(context, owner, validEventId, validText, tempFilePath)
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

        OnDestroy {
            synchronized(initLock) {
                isDestroyed = true
            }
            try {
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

    private fun startServicePlayback(
        context: Context,
        owner: PetSpeechResourceOwner,
        eventId: String,
        text: String,
        tempFilePath: String
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

                    foregroundService.playSpeech(owner.id, eventId, text, tempFilePath) { id, outcome ->
                        owner.settle(outcome)
                    }
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
