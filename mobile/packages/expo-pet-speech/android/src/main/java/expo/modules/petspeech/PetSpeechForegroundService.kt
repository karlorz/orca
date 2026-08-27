package expo.modules.petspeech

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaPlayer
import android.media.PlaybackParams
import android.os.Binder
import android.os.Build
import android.os.IBinder
import android.support.v4.media.session.MediaSessionCompat
import androidx.core.app.NotificationCompat
import androidx.media.app.NotificationCompat as MediaNotificationCompat
import java.io.File

class PetSpeechForegroundService : Service() {

    companion object {
        const val NOTIFICATION_CHANNEL_ID = "orca_pet_speech_playback"
        const val NOTIFICATION_CHANNEL_NAME = "Orca Pet Speech"
        const val NOTIFICATION_ID = 4040
        const val EXTRA_TEXT = "extra_pet_speech_text"
        const val EXTRA_OWNER_ID = "extra_pet_speech_owner_id"
        const val ACTION_STOP_OWNER = "expo.modules.petspeech.ACTION_STOP_OWNER"
        const val ACTION_HOLD_SESSION = "expo.modules.petspeech.ACTION_HOLD_SESSION"
        const val ACTION_RELEASE_SESSION = "expo.modules.petspeech.ACTION_RELEASE_SESSION"
        const val ACTION_UPDATE_HELD_NOTIFICATION = "expo.modules.petspeech.ACTION_UPDATE_HELD_NOTIFICATION"
        private const val PREFS_NAME = "expo.modules.petspeech.prefs"
        private const val KEY_IS_HELD = "key_is_held"
        private const val KEY_HELD_TEXT = "key_held_text"
    }

    private val binder = LocalBinder()
    private var mediaPlayer: MediaPlayer? = null
    private var mediaSession: MediaSessionCompat? = null
    private var audioManager: AudioManager? = null
    private var audioFocusRequest: AudioFocusRequest? = null
    private var stateMachine: PetSpeechStateMachine? = null
    private var isForegroundStarted = false

    private val replacementDecisionHandler = PetSpeechServiceReplacementDecisionHandler(
        onStopSelf = {
            stopSelf()
        },
        onStopForeground = {
            stopForegroundPlayback()
        },
        onUpdateNotification = { text ->
            updateNotificationContent(text)
        }
    )

    private val audioFocusChangeListener = AudioManager.OnAudioFocusChangeListener { focusChange ->
        when (focusChange) {
            AudioManager.AUDIOFOCUS_LOSS,
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> {
                stateMachine?.onAudioFocusLost()
            }
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> {
                try {
                    mediaPlayer?.setVolume(0.2f, 0.2f)
                } catch (_: Exception) {}
            }
            AudioManager.AUDIOFOCUS_GAIN -> {
                try {
                    mediaPlayer?.setVolume(1.0f, 1.0f)
                } catch (_: Exception) {}
            }
        }
    }

    inner class LocalBinder : Binder() {
        fun getService(): PetSpeechForegroundService = this@PetSpeechForegroundService
    }

    override fun onBind(intent: Intent?): IBinder = binder

    override fun onCreate() {
        super.onCreate()
        audioManager = getSystemService(Context.AUDIO_SERVICE) as? AudioManager
        mediaSession = MediaSessionCompat(this, "PetSpeechSession").apply {
            isActive = true
        }
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

        if (intent == null) {
            val wasHeld = prefs.getBoolean(KEY_IS_HELD, false)
            if (wasHeld) {
                val savedText = prefs.getString(KEY_HELD_TEXT, PetSpeechForegroundStart.IDLE_NOTIFICATION_TEXT)
                    ?: PetSpeechForegroundStart.IDLE_NOTIFICATION_TEXT
                replacementDecisionHandler.holdSession(savedText)
                return PetSpeechStartResultDecision.computeStartResult(isHeld = true)
            }
            stopForegroundPlayback()
            stopSelf()
            return PetSpeechStartResultDecision.computeStartResult(isHeld = false)
        }

        if (intent.action == ACTION_HOLD_SESSION) {
            val text = intent.getStringExtra(EXTRA_TEXT) ?: PetSpeechForegroundStart.IDLE_NOTIFICATION_TEXT
            prefs.edit()
                .putBoolean(KEY_IS_HELD, true)
                .putString(KEY_HELD_TEXT, text)
                .apply()
            replacementDecisionHandler.holdSession(text)
            return PetSpeechStartResultDecision.computeStartResult(isHeld = true)
        }

        if (intent.action == ACTION_UPDATE_HELD_NOTIFICATION) {
            val text = intent.getStringExtra(EXTRA_TEXT) ?: PetSpeechForegroundStart.IDLE_NOTIFICATION_TEXT
            if (replacementDecisionHandler.isSessionHeld) {
                prefs.edit()
                    .putString(KEY_HELD_TEXT, text)
                    .apply()
                replacementDecisionHandler.updateHeldNotification(text)
            }
            return PetSpeechStartResultDecision.computeStartResult(replacementDecisionHandler.isSessionHeld)
        }

        if (intent.action == ACTION_RELEASE_SESSION) {
            prefs.edit()
                .putBoolean(KEY_IS_HELD, false)
                .remove(KEY_HELD_TEXT)
                .apply()
            replacementDecisionHandler.releaseSession()
            return PetSpeechStartResultDecision.computeStartResult(isHeld = false)
        }

        if (intent.action == ACTION_STOP_OWNER) {
            val stopOwnerId = intent.getLongExtra(EXTRA_OWNER_ID, -1L)
            if (stopOwnerId != -1L) {
                cancelSpeech(stopOwnerId)
            }
            return PetSpeechStartResultDecision.computeStartResult(replacementDecisionHandler.isSessionHeld)
        }

        val ownerId = intent.getLongExtra(EXTRA_OWNER_ID, -1L)
        val extraText = intent.getStringExtra(EXTRA_TEXT)

        when (val decision = PetSpeechStartCommandDecision.decide(extraText)) {
            is PetSpeechStartCommandDecision.Result.StopSelf -> {
                stopForegroundPlayback()
                stopSelf()
                return PetSpeechStartResultDecision.computeStartResult(replacementDecisionHandler.isSessionHeld)
            }
            is PetSpeechStartCommandDecision.Result.StartForeground -> {
                replacementDecisionHandler.onStartCommand(ownerId, decision.trimmedText)
                return PetSpeechStartResultDecision.computeStartResult(replacementDecisionHandler.isSessionHeld)
            }
        }
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                NOTIFICATION_CHANNEL_ID,
                NOTIFICATION_CHANNEL_NAME,
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Orca Pet Speech playback"
                setShowBadge(false)
                setSound(null, null)
                enableVibration(false)
            }
            val manager = getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
            manager?.createNotificationChannel(channel)
        }
    }

    fun playSpeech(
        ownerId: Long,
        eventId: String,
        text: String,
        tempFilePath: String,
        rate: Float = PetSpeechRate.DEFAULT,
        onOutcome: (String, PetSpeechOutcome) -> Unit
    ) {
        // Reset player and focus for incoming utterance
        teardownMediaPlayerAndFocus()

        replacementDecisionHandler.beginPlayback(ownerId, eventId, text, onOutcome)

        stateMachine = PetSpeechStateMachine { action ->
            when (action) {
                is PetSpeechStateMachine.Action.RequestAudioFocus -> {
                    val granted = requestSpeechAudioFocus()
                    if (granted) {
                        stateMachine?.onAudioFocusGranted()
                    } else {
                        stateMachine?.onAudioFocusDenied()
                    }
                }
                is PetSpeechStateMachine.Action.PlayAudioFile -> {
                    playAudio(action.filePath, PetSpeechRate.androidPlaybackSpeed(rate))
                }
                is PetSpeechStateMachine.Action.AbandonAudioFocus -> {
                    abandonSpeechAudioFocus()
                }
                is PetSpeechStateMachine.Action.StopForeground -> {
                    if (!replacementDecisionHandler.isSessionHeld) {
                        stopForegroundPlayback()
                    }
                }
                is PetSpeechStateMachine.Action.DeleteTempFile -> {
                    deleteFileSafely(action.filePath)
                }
                is PetSpeechStateMachine.Action.NotifyOutcome -> {
                    stateMachine = null
                    teardownMediaPlayerAndFocus()
                    replacementDecisionHandler.completePlayback(ownerId, action.outcome)
                }
            }
        }

        stateMachine?.onStartSynthesis(eventId, text, tempFilePath)
        stateMachine?.onSynthesisSuccess()
    }

    fun cancelSpeech(ownerId: Long) {
        if (replacementDecisionHandler.activeOwnerId == ownerId) {
            stateMachine = null
            teardownMediaPlayerAndFocus()
            replacementDecisionHandler.cancelSpeech(ownerId)
        }
    }

    private fun teardownMediaPlayerAndFocus() {
        try {
            mediaPlayer?.stop()
            mediaPlayer?.release()
            mediaPlayer = null
        } catch (_: Exception) {}
        abandonSpeechAudioFocus()
    }

    private fun updateNotificationContent(text: String) {
        val sessionToken = mediaSession?.sessionToken
        val notification = NotificationCompat.Builder(this, NOTIFICATION_CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_lock_silent_mode_off)
            .setContentTitle("Orca Pet")
            .setContentText(text)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .apply {
                if (sessionToken != null) {
                    setStyle(MediaNotificationCompat.MediaStyle().setMediaSession(sessionToken))
                }
            }
            .build()

        if (!isForegroundStarted) {
            val started = PetSpeechForegroundStart.tryStartForeground {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    startForeground(
                        NOTIFICATION_ID,
                        notification,
                        ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
                    )
                } else {
                    startForeground(NOTIFICATION_ID, notification)
                }
            }
            if (started) {
                isForegroundStarted = true
            }
        } else {
            val manager = getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
            manager?.notify(NOTIFICATION_ID, notification)
        }
    }

    private fun requestSpeechAudioFocus(): Boolean {
        val am = audioManager ?: return false
        val result = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val audioAttributes = AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                .build()

            val req = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
                .setAudioAttributes(audioAttributes)
                .setOnAudioFocusChangeListener(audioFocusChangeListener)
                .build()
            audioFocusRequest = req
            am.requestAudioFocus(req)
        } else {
            @Suppress("DEPRECATION")
            am.requestAudioFocus(
                audioFocusChangeListener,
                AudioManager.STREAM_MUSIC,
                AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK
            )
        }
        return result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
    }

    private fun abandonSpeechAudioFocus() {
        val am = audioManager ?: return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            audioFocusRequest?.let { am.abandonAudioFocusRequest(it) }
            audioFocusRequest = null
        } else {
            @Suppress("DEPRECATION")
            am.abandonAudioFocus(audioFocusChangeListener)
        }
    }

    private fun playAudio(filePath: String, rate: Float) {
        try {
            mediaPlayer?.release()
            mediaPlayer = MediaPlayer().apply {
                setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_MEDIA)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                        .build()
                )
                setDataSource(filePath)
                setOnCompletionListener {
                    stateMachine?.onPlaybackComplete()
                }
                setOnErrorListener { _, _, _ ->
                    stateMachine?.onPlaybackError()
                    true
                }
                prepare()
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    try {
                        playbackParams = PlaybackParams()
                            .setSpeed(rate)
                            .setPitch(1.0f)
                    } catch (_: Exception) {
                    }
                }
                start()
            }
        } catch (_: Exception) {
            stateMachine?.onPlaybackError()
        }
    }

    private fun stopForegroundPlayback() {
        try {
            mediaPlayer?.stop()
            mediaPlayer?.release()
            mediaPlayer = null
        } catch (_: Exception) {}

        if (isForegroundStarted) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                stopForeground(STOP_FOREGROUND_REMOVE)
            } else {
                @Suppress("DEPRECATION")
                stopForeground(true)
            }
            isForegroundStarted = false
        }
    }

    private fun deleteFileSafely(filePath: String) {
        try {
            val file = File(filePath)
            if (file.exists()) {
                file.delete()
            }
        } catch (_: Exception) {}
    }

    override fun onDestroy() {
        val currentOwnerId = replacementDecisionHandler.activeOwnerId
        if (currentOwnerId != null) {
            cancelSpeech(currentOwnerId)
        }
        stopForegroundPlayback()
        mediaPlayer?.release()
        mediaPlayer = null
        mediaSession?.release()
        mediaSession = null
        abandonSpeechAudioFocus()
        super.onDestroy()
    }
}
