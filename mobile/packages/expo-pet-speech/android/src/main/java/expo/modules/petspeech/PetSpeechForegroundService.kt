package expo.modules.petspeech

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Binder
import android.os.Build
import android.os.IBinder
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import android.view.KeyEvent
import androidx.core.app.NotificationCompat
import androidx.media.app.NotificationCompat as MediaNotificationCompat
import java.io.File

class PetSpeechForegroundService : Service() {

    companion object {
        const val NOTIFICATION_CHANNEL_ID = PetSpeechPlaybackChannel.ID
        const val NOTIFICATION_CHANNEL_NAME = PetSpeechPlaybackChannel.NAME
        const val NOTIFICATION_ID = PetSpeechNotificationSetDecision.FGS_NOTIFICATION_ID
        const val EXTRA_TEXT = "extra_pet_speech_text"
        const val EXTRA_OWNER_ID = "extra_pet_speech_owner_id"
        const val ACTION_STOP_OWNER = "expo.modules.petspeech.ACTION_STOP_OWNER"
        const val ACTION_HOLD_SESSION = "expo.modules.petspeech.ACTION_HOLD_SESSION"
        const val ACTION_RELEASE_SESSION = "expo.modules.petspeech.ACTION_RELEASE_SESSION"
        const val ACTION_PAUSE_PERSIST = "expo.modules.petspeech.ACTION_PAUSE_PERSIST"
        const val ACTION_RESUME_FROM_CHIP = "expo.modules.petspeech.ACTION_RESUME_FROM_CHIP"
        const val ACTION_UPDATE_HELD_NOTIFICATION = "expo.modules.petspeech.ACTION_UPDATE_HELD_NOTIFICATION"
        const val EXTRA_RELEASE_REASON = "extra_pet_speech_release_reason"
        const val PREFS_NAME = "expo.modules.petspeech.prefs"
        const val KEY_IS_HELD = "key_is_held"
        private const val KEY_HELD_TEXT = "key_held_text"
    }

    private val binder = LocalBinder()
    private var audioPlayer: PetSpeechAudioPlayer? = null
    private var mediaSession: MediaSessionCompat? = null
    private var audioManager: AudioManager? = null
    private var audioFocusRequest: AudioFocusRequest? = null
    private var stateMachine: PetSpeechStateMachine? = null
    private var isForegroundStarted = false
    private var onPlaybackStarted: (() -> Unit)? = null

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

    private val visibilityReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            val prefs = PetSpeechPersistPrefs.read(this@PetSpeechForegroundService)
            applyVisibilityDecision(
                PetSpeechVisibilityHoldDecision.applyAction(
                    intent?.action,
                    persistEnabled = prefs.persistEnabled,
                    masterEnabled = prefs.masterEnabled,
                    sessionHeld = replacementDecisionHandler.isSessionHeld,
                    keepWhenNoHost = prefs.keepWhenNoHost,
                    overlayWhileSpeaking = prefs.overlayWhileSpeaking
                )
            )
        }
    }

    private val audioFocusChangeListener = AudioManager.OnAudioFocusChangeListener { focusChange ->
        when (focusChange) {
            AudioManager.AUDIOFOCUS_LOSS,
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> {
                stateMachine?.onAudioFocusLost()
            }
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> {
                try {
                    audioPlayer?.setVolume(0.2f)
                } catch (_: Exception) {}
            }
            AudioManager.AUDIOFOCUS_GAIN -> {
                try {
                    audioPlayer?.setVolume(1.0f)
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
            setFlags(
                MediaSessionCompat.FLAG_HANDLES_MEDIA_BUTTONS or
                    MediaSessionCompat.FLAG_HANDLES_TRANSPORT_CONTROLS
            )
            setCallback(object : MediaSessionCompat.Callback() {
                override fun onPause() {
                    dispatchMediaCommand(PetSpeechMediaCommandDecision.Command.PAUSE)
                }

                override fun onStop() {
                    dispatchMediaCommand(PetSpeechMediaCommandDecision.Command.STOP)
                }

                override fun onPlay() {
                    dispatchMediaCommand(PetSpeechMediaCommandDecision.Command.PLAY)
                }

                override fun onMediaButtonEvent(mediaButtonEvent: Intent?): Boolean {
                    val keyEvent = mediaButtonKeyEvent(mediaButtonEvent) ?: return super.onMediaButtonEvent(mediaButtonEvent)
                    if (keyEvent.action != KeyEvent.ACTION_DOWN) {
                        return super.onMediaButtonEvent(mediaButtonEvent)
                    }
                    val command = PetSpeechMediaCommandDecision.commandFromKeyCode(keyEvent.keyCode)
                        ?: return super.onMediaButtonEvent(mediaButtonEvent)
                    dispatchMediaCommand(command)
                    return true
                }
            })
            setMediaButtonReceiver(mediaButtonPendingIntent())
            isActive = true
        }
        PetSpeechPlaybackChannel.ensure(this)
        PetSpeechNotificationCoordinator.ensureChannels(this)
        registerReceiver(
            visibilityReceiver,
            IntentFilter().apply {
                addAction(PetSpeechVisibilityHoldDecision.ACTION_SCREEN_OFF)
                addAction(PetSpeechVisibilityHoldDecision.ACTION_USER_PRESENT)
            }
        )
    }

    fun isForegroundHeld(): Boolean {
        return isForegroundStarted && replacementDecisionHandler.isSessionHeld
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

        if (intent == null) {
            val wasHeld = prefs.getBoolean(KEY_IS_HELD, false)
            if (wasHeld) {
                val savedText = prefs.getString(KEY_HELD_TEXT, PetSpeechForegroundStart.IDLE_NOTIFICATION_TEXT)
                    ?: PetSpeechForegroundStart.IDLE_NOTIFICATION_TEXT
                replacementDecisionHandler.holdSession(savedText)
                updateNotificationContent(savedText)
                if (isForegroundStarted) {
                    applyHeldNotifications()
                }
                return PetSpeechStartResultDecision.computeStartResult(isHeld = true)
            }
            stopForegroundPlayback()
            stopSelf()
            return PetSpeechStartResultDecision.computeStartResult(isHeld = false)
        }

        if (PetSpeechHoldCommandDecision.isHoldOnlyAction(intent.action)) {
            val persist = PetSpeechPersistPrefs.read(this)
            val source = PetSpeechHoldCommandDecision.parseSource(
                intent.action,
                intent.getStringExtra(PetSpeechHoldCommandDecision.EXTRA_HOLD_SOURCE)
            )
            val hold = PetSpeechHoldCommandDecision.decide(
                source,
                persistEnabled = persist.persistEnabled,
                masterEnabled = persist.masterEnabled,
                keepWhenNoHost = persist.keepWhenNoHost,
                overlayWhileSpeaking = persist.overlayWhileSpeaking,
                afterKeepHoldPause = source == PetSpeechHoldCommandDecision.Source.RESUME_CHIP ||
                    source == PetSpeechHoldCommandDecision.Source.MEDIA_PLAY_AFTER_PAUSE
            )
            if (hold.serviceAction == null || !hold.reacquireHold || hold.startTts) {
                return PetSpeechStartResultDecision.computeStartResult(isHeld = false)
            }
            val text = intent.getStringExtra(EXTRA_TEXT) ?: PetSpeechForegroundStart.IDLE_NOTIFICATION_TEXT
            replacementDecisionHandler.holdSession(text)
            updateNotificationContent(text)
            val held = hold.reacquireHold &&
                PetSpeechHoldHonestyDecision.shouldMarkHeld(isForegroundStarted)
            if (held) {
                prefs.edit()
                    .putBoolean(KEY_IS_HELD, true)
                    .putString(KEY_HELD_TEXT, text)
                    .apply()
                applyHeldNotifications()
            } else {
                prefs.edit()
                    .putBoolean(KEY_IS_HELD, false)
                    .remove(KEY_HELD_TEXT)
                    .apply()
                replacementDecisionHandler.releaseSession()
                PetSpeechNotificationCoordinator.cancelAll(this)
            }
            return PetSpeechStartResultDecision.computeStartResult(isHeld = held)
        }

        if (intent.action == ACTION_UPDATE_HELD_NOTIFICATION) {
            val text = intent.getStringExtra(EXTRA_TEXT) ?: PetSpeechForegroundStart.IDLE_NOTIFICATION_TEXT
            if (replacementDecisionHandler.isSessionHeld) {
                prefs.edit()
                    .putString(KEY_HELD_TEXT, text)
                    .apply()
                replacementDecisionHandler.updateHeldNotification(text)
                applyHeldNotifications()
            }
            return PetSpeechStartResultDecision.computeStartResult(replacementDecisionHandler.isSessionHeld)
        }

        if (intent.action == Intent.ACTION_MEDIA_BUTTON) {
            val keyEvent = mediaButtonKeyEvent(intent)
            val command = if (keyEvent == null || keyEvent.action != KeyEvent.ACTION_DOWN) {
                PetSpeechMediaCommandDecision.Command.PAUSE
            } else {
                PetSpeechMediaCommandDecision.commandFromKeyCode(keyEvent.keyCode)
                    ?: PetSpeechMediaCommandDecision.Command.PAUSE
            }
            dispatchMediaCommand(command)
            return PetSpeechStartResultDecision.computeStartResult(
                isHeld = replacementDecisionHandler.isSessionHeld
            )
        }

        if (intent.action == ACTION_PAUSE_PERSIST) {
            val persist = PetSpeechPersistPrefs.read(this)
            handleReleaseSession(
                PetSpeechMediaCommandDecision.releaseReason(
                    persistEnabled = persist.persistEnabled,
                    masterEnabled = persist.masterEnabled
                )
            )
            return PetSpeechStartResultDecision.computeStartResult(isHeld = false)
        }

        if (intent.action == ACTION_RELEASE_SESSION) {
            val persist = PetSpeechPersistPrefs.read(this)
            handleReleaseSession(
                PetSpeechReleaseAftermathDecision.resolveReason(
                    intent.getStringExtra(EXTRA_RELEASE_REASON),
                    persist.persistEnabled,
                    persist.masterEnabled
                )
            )
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

    fun playSpeech(
        ownerId: Long,
        eventId: String,
        text: String,
        tempFilePath: String,
        rate: Float = PetSpeechRate.DEFAULT,
        debug: Boolean = false,
        playerKind: PetSpeechPlayerKind = PetSpeechPlayerProvider.defaultPlayerKind,
        onOutcome: (String, PetSpeechOutcome) -> Unit,
        onPlaybackStarted: () -> Unit = {}
    ) {
        // Reset player and focus for incoming utterance
        teardownAudioPlayerAndFocus()
        this.onPlaybackStarted = onPlaybackStarted

        PetSpeechSpeakOverlayHelper.showIfAllowed(this, text)
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
                    playAudio(eventId, action.filePath, PetSpeechRate.androidPlaybackSpeed(rate), debug, playerKind)
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
                    safeTeardownAudioPlayer()
                    deleteFileSafely(action.filePath)
                }
                is PetSpeechStateMachine.Action.NotifyOutcome -> {
                    stateMachine = null
                    safeTeardownAudioPlayer()
                    abandonSpeechAudioFocus()
                    PetSpeechSpeakOverlayHelper.hide(this@PetSpeechForegroundService)
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
            onPlaybackStarted = null
            teardownAudioPlayerAndFocus()
            PetSpeechSpeakOverlayHelper.hide(this)
            replacementDecisionHandler.cancelSpeech(ownerId)
        }
    }

    private fun safeTeardownAudioPlayer() {
        try {
            audioPlayer?.stopAndRelease()
        } catch (_: Exception) {}
        audioPlayer = null
    }

    private fun teardownAudioPlayerAndFocus() {
        safeTeardownAudioPlayer()
        abandonSpeechAudioFocus()
    }

    private fun handleReleaseSession(reason: PetSpeechReleaseAftermathDecision.Reason) {
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        stopActiveSpeech()
        clearHeldPrefs(prefs)
        replacementDecisionHandler.releaseSession()
        PetSpeechSpeakOverlayHelper.hide(this)
        val contract = PetSpeechReleaseAftermathDecision.contract(reason)
        if (contract.startTts || contract.reacquireHold ||
            contract.serviceAction == PetSpeechHoldCommandDecision.ACTION_HOLD_SESSION
        ) {
            return
        }
        if (contract.cancelMediaStyle) {
            stopForegroundPlayback()
        }
        PetSpeechNotificationCoordinator.applyPlan(
            this,
            PetSpeechReleaseAftermathDecision.notificationPlan(reason)
        )
        if (contract.cancelMediaStyle) {
            stopSelf()
        }
    }

    private fun dispatchMediaCommand(command: PetSpeechMediaCommandDecision.Command) {
        val persist = PetSpeechPersistPrefs.read(this)
        val outcome = PetSpeechMediaCommandDecision.decide(
            command = command,
            sessionHeld = replacementDecisionHandler.isSessionHeld,
            speechActive = audioPlayer != null,
            persistEnabled = persist.persistEnabled,
            masterEnabled = persist.masterEnabled,
            keepWhenNoHost = persist.keepWhenNoHost,
            overlayWhileSpeaking = persist.overlayWhileSpeaking,
            visibilityKeepHold = replacementDecisionHandler.isSessionHeld
        )
        when (outcome) {
            PetSpeechMediaCommandDecision.Outcome.RELEASE_AND_STOP_TTS -> {
                handleReleaseSession(
                    PetSpeechMediaCommandDecision.releaseReason(
                        persistEnabled = persist.persistEnabled,
                        masterEnabled = persist.masterEnabled
                    )
                )
            }
            PetSpeechMediaCommandDecision.Outcome.RESUME -> {
                val hold = PetSpeechHoldCommandDecision.decide(
                    PetSpeechHoldCommandDecision.Source.MEDIA_PLAY_AFTER_PAUSE,
                    persistEnabled = persist.persistEnabled,
                    masterEnabled = persist.masterEnabled,
                    keepWhenNoHost = persist.keepWhenNoHost,
                    overlayWhileSpeaking = persist.overlayWhileSpeaking,
                    afterKeepHoldPause = true
                )
                val action = hold.serviceAction ?: return
                startService(
                    Intent(this, PetSpeechForegroundService::class.java).apply {
                        this.action = action
                        putExtra(
                            PetSpeechHoldCommandDecision.EXTRA_HOLD_SOURCE,
                            PetSpeechHoldCommandDecision.Source.MEDIA_PLAY_AFTER_PAUSE.name
                        )
                    }
                )
            }
            PetSpeechMediaCommandDecision.Outcome.IGNORE -> Unit
        }
    }

    private fun mediaButtonPendingIntent(): PendingIntent {
        return PendingIntent.getService(
            this,
            13,
            Intent(this, PetSpeechForegroundService::class.java).apply {
                action = Intent.ACTION_MEDIA_BUTTON
            },
            PetSpeechNotificationCoordinator.pendingFlags()
        )
    }

    private fun mediaButtonKeyEvent(source: Intent?): KeyEvent? {
        if (source == null) {
            return null
        }
        return if (Build.VERSION.SDK_INT >= 33) {
            source.getParcelableExtra(Intent.EXTRA_KEY_EVENT, KeyEvent::class.java)
        } else {
            @Suppress("DEPRECATION")
            source.getParcelableExtra(Intent.EXTRA_KEY_EVENT)
        }
    }

    private fun applyHeldNotifications() {
        refreshServiceRowFromPrefs(PetSpeechPersistPrefs.read(this).showServiceRow)
    }

    fun refreshServiceRowFromPrefs(showServiceRow: Boolean = PetSpeechPersistPrefs.read(this).showServiceRow) {
        PetSpeechNotificationCoordinator.applyServiceRow(
            this,
            show = isForegroundHeld() && showServiceRow
        )
    }

    private fun clearHeldPrefs(prefs: android.content.SharedPreferences) {
        prefs.edit()
            .putBoolean(KEY_IS_HELD, false)
            .remove(KEY_HELD_TEXT)
            .apply()
    }

    private fun stopActiveSpeech() {
        val ownerId = replacementDecisionHandler.activeOwnerId
        if (ownerId != null) {
            cancelSpeech(ownerId)
        } else {
            teardownAudioPlayerAndFocus()
        }
    }

    private fun publishHoldMediaSession(text: String) {
        val session = mediaSession ?: return
        session.setMetadata(
            MediaMetadataCompat.Builder()
                .putString(MediaMetadataCompat.METADATA_KEY_TITLE, "Orca Pet")
                .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, text)
                .putString(MediaMetadataCompat.METADATA_KEY_DISPLAY_TITLE, "Orca Pet")
                .putString(MediaMetadataCompat.METADATA_KEY_DISPLAY_SUBTITLE, text)
                .build()
        )
        session.setPlaybackState(
            PlaybackStateCompat.Builder()
                .setActions(PetSpeechMediaHoldDecision.playbackActions())
                .setState(
                    PlaybackStateCompat.STATE_PLAYING,
                    PlaybackStateCompat.PLAYBACK_POSITION_UNKNOWN,
                    1.0f
                )
                .build()
        )
        session.isActive = true
    }

    private fun updateNotificationContent(text: String) {
        publishHoldMediaSession(text)
        val sessionToken = mediaSession?.sessionToken
        val pauseIntent = PendingIntent.getService(
            this,
            10,
            Intent(this, PetSpeechForegroundService::class.java).apply {
                action = ACTION_RELEASE_SESSION
                putExtra(EXTRA_RELEASE_REASON, PetSpeechReleaseAftermathDecision.Reason.PAUSE.name)
            },
            PetSpeechNotificationCoordinator.pendingFlags()
        )
        val mediaStyle = MediaNotificationCompat.MediaStyle().setShowActionsInCompactView(0)
        if (sessionToken != null) {
            mediaStyle.setMediaSession(sessionToken)
        }
        val notification = NotificationCompat.Builder(this, NOTIFICATION_CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_media_pause)
            .setContentTitle("Orca Pet")
            .setContentText(text)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .addAction(android.R.drawable.ic_media_pause, "Pause", pauseIntent)
            .setStyle(mediaStyle)
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

    private fun playAudio(
        eventId: String,
        filePath: String,
        rate: Float,
        debug: Boolean = false,
        playerKind: PetSpeechPlayerKind = PetSpeechPlayerProvider.defaultPlayerKind
    ) {
        try {
            safeTeardownAudioPlayer()
            val player = PetSpeechPlayerProvider.createPlayer(playerKind)
            audioPlayer = player

            val playerStartTime = System.currentTimeMillis()
            PetSpeechPlaybackInstrumentation.recordPlayerStarted(
                eventId = eventId,
                playerImplementation = player.implementationName,
                selectedRate = rate,
                timestampMs = playerStartTime
            )

            player.play(
                context = this,
                filePath = filePath,
                rate = rate,
                debug = debug,
                onStarted = {
                    onPlaybackStarted?.invoke()
                },
                onComplete = {
                    val durationMs = System.currentTimeMillis() - playerStartTime
                    PetSpeechPlaybackInstrumentation.recordPlayerCompleted(
                        eventId = eventId,
                        durationMs = durationMs
                    )
                    stateMachine?.onPlaybackComplete()
                },
                onError = { reason ->
                    PetSpeechPlaybackInstrumentation.recordPlayerFailed(
                        eventId = eventId,
                        failureReason = reason
                    )
                    stateMachine?.onPlaybackError()
                }
            )
        } catch (e: Exception) {
            PetSpeechPlaybackInstrumentation.recordPlayerFailed(
                eventId = eventId,
                failureReason = e.message ?: "playAudio exception"
            )
            stateMachine?.onPlaybackError()
        }
    }

    private fun stopForegroundPlayback() {
        safeTeardownAudioPlayer()

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

    override fun onTaskRemoved(rootIntent: Intent?) {
        val prefs = PetSpeechPersistPrefs.read(this)
        val decision = PetSpeechVisibilityHoldDecision.decide(
            PetSpeechVisibilityHoldDecision.Event.HOME,
            persistEnabled = prefs.persistEnabled,
            masterEnabled = prefs.masterEnabled,
            sessionHeld = replacementDecisionHandler.isSessionHeld,
            keepWhenNoHost = prefs.keepWhenNoHost
        )
        if (applyVisibilityDecision(decision)) {
            return
        }
        super.onTaskRemoved(rootIntent)
    }

    private fun applyVisibilityDecision(
        decision: PetSpeechVisibilityHoldDecision.Result?
    ): Boolean {
        if (decision == null) {
            return false
        }
        if (decision.keepHold) {
            return true
        }
        if (decision.releaseSession) {
            handleReleaseSession(PetSpeechReleaseAftermathDecision.Reason.MASTER_OFF)
            return true
        }
        return false
    }

    override fun onDestroy() {
        try {
            unregisterReceiver(visibilityReceiver)
        } catch (_: Exception) {
        }
        val currentOwnerId = replacementDecisionHandler.activeOwnerId
        if (currentOwnerId != null) {
            cancelSpeech(currentOwnerId)
        }
        PetSpeechSpeakOverlayHelper.hide(this)
        stopForegroundPlayback()
        safeTeardownAudioPlayer()
        mediaSession?.release()
        mediaSession = null
        abandonSpeechAudioFocus()
        super.onDestroy()
    }
}
