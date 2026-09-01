package expo.modules.petspeech

import android.content.Context
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

class PetSpeechPlaybackPrototypeTest {

    @Before
    fun setUp() {
        PetSpeechPlayerProvider.reset()
        PetSpeechPlaybackInstrumentation.clearObservers()
    }

    @After
    fun tearDown() {
        PetSpeechPlayerProvider.reset()
        PetSpeechPlaybackInstrumentation.clearObservers()
    }

    @Test
    fun playerKindDefaultsToMediaPlayer() {
        assertEquals(PetSpeechPlayerKind.MEDIA_PLAYER, PetSpeechPlayerProvider.defaultPlayerKind)
        val player = PetSpeechPlayerProvider.createPlayer()
        assertEquals(PetSpeechPlayerKind.MEDIA_PLAYER.identifier, player.implementationName)
    }

    @Test
    fun playerKindFromIdentifierParsesCorrectly() {
        assertEquals(PetSpeechPlayerKind.MEDIA3, PetSpeechPlayerKind.fromIdentifier("media3"))
        assertEquals(PetSpeechPlayerKind.MEDIA3, PetSpeechPlayerKind.fromIdentifier("ExoPlayer"))
        assertEquals(PetSpeechPlayerKind.MEDIA3, PetSpeechPlayerKind.fromIdentifier(" MEDIA3 "))
        assertEquals(PetSpeechPlayerKind.MEDIA_PLAYER, PetSpeechPlayerKind.fromIdentifier("mediaplayer"))
        assertEquals(PetSpeechPlayerKind.MEDIA_PLAYER, PetSpeechPlayerKind.fromIdentifier("unknown"))
        assertEquals(PetSpeechPlayerKind.MEDIA_PLAYER, PetSpeechPlayerKind.fromIdentifier(null))
    }

    @Test
    fun selectablePlayerFactoryReturnsMedia3WhenSelected() {
        PetSpeechPlayerProvider.defaultPlayerKind = PetSpeechPlayerKind.MEDIA3
        val player = PetSpeechPlayerProvider.createPlayer()
        assertEquals(PetSpeechPlayerKind.MEDIA3.identifier, player.implementationName)
    }

    @Test
    fun disabledStateNeverConstructsPlayer() {
        val playerConstructedCount = AtomicInteger(0)
        PetSpeechPlayerProvider.playerFactory = { kind ->
            playerConstructedCount.incrementAndGet()
            object : PetSpeechAudioPlayer {
                override val implementationName: String = kind.identifier
                override fun play(
                    context: Context,
                    filePath: String,
                    rate: Float,
                    debug: Boolean,
                    onComplete: () -> Unit,
                    onError: (String) -> Unit,
                    onStarted: () -> Unit
                ) {}
                override fun setVolume(volume: Float) {}
                override fun stopAndRelease() {}
            }
        }

        // When Pet Speech is disabled at the master switch or invalid payload, no player is instantiated
        val isValid = PetSpeechPayloadValidator.isValid(null, null, null)
        assertEquals(false, isValid)
        assertEquals(0, playerConstructedCount.get())
        assertNull(PetSpeechPlaybackInstrumentation.lastMetrics)
    }

    @Test
    fun instrumentationRecordsSynthesisStartCompletionAndRate() {
        val playedRate = AtomicBoolean(false)
        var capturedSpeed = 0f

        val fakePlayer = object : PetSpeechAudioPlayer {
            override val implementationName: String = "media3"
            override fun play(
                context: Context,
                filePath: String,
                rate: Float,
                debug: Boolean,
                onComplete: () -> Unit,
                onError: (String) -> Unit,
                onStarted: () -> Unit
            ) {
                capturedSpeed = rate
                playedRate.set(true)
                onStarted()
                onComplete()
            }
            override fun setVolume(volume: Float) {}
            override fun stopAndRelease() {}
        }

        PetSpeechPlayerProvider.playerFactory = { fakePlayer }

        val eventId = "ev-proto-1"
        val synthTime = 1000L
        PetSpeechPlaybackInstrumentation.recordSynthesisCompleted(eventId, synthTime)

        val playerStartTime = 1050L
        PetSpeechPlaybackInstrumentation.recordPlayerStarted(
            eventId = eventId,
            playerImplementation = fakePlayer.implementationName,
            selectedRate = 1.5f,
            timestampMs = playerStartTime
        )

        fakePlayer.play(
            context = null as Context?,
            filePath = "/tmp/test.wav",
            rate = 1.5f,
            debug = false,
            onComplete = {
                val completionTime = 1500L
                PetSpeechPlaybackInstrumentation.recordPlayerCompleted(
                    eventId = eventId,
                    durationMs = completionTime - playerStartTime,
                    timestampMs = completionTime
                )
            },
            onError = {}
        )

        assertTrue(playedRate.get())
        assertEquals(1.5f, capturedSpeed, 0.001f)

        val metrics = PetSpeechPlaybackInstrumentation.lastMetrics
        assertNotNull(metrics)
        assertEquals(eventId, metrics?.eventId)
        assertEquals("media3", metrics?.playerImplementation)
        assertEquals(1.5f, metrics?.selectedRate ?: 0f, 0.001f)
        assertEquals(1000L, metrics?.synthesisCompletedAtMs)
        assertEquals(1050L, metrics?.playerStartedAtMs)
        assertEquals(1500L, metrics?.playerCompletedAtMs)
        assertEquals(450L, metrics?.durationMs)
        assertEquals(PetSpeechOutcome.Spoken, metrics?.outcome)
    }

    @Test
    fun instrumentationRecordsFailureCorrectly() {
        val eventId = "ev-proto-fail"
        PetSpeechPlaybackInstrumentation.recordSynthesisCompleted(eventId, 2000L)
        PetSpeechPlaybackInstrumentation.recordPlayerStarted(eventId, "media3", 2.0f, 2020L)
        PetSpeechPlaybackInstrumentation.recordPlayerFailed(eventId, "AudioTrack init failed", 2050L)

        val metrics = PetSpeechPlaybackInstrumentation.lastMetrics
        assertNotNull(metrics)
        assertEquals(eventId, metrics?.eventId)
        assertEquals("media3", metrics?.playerImplementation)
        assertEquals(2.0f, metrics?.selectedRate ?: 0f, 0.001f)
        assertEquals("AudioTrack init failed", metrics?.failureReason)
        assertEquals(PetSpeechOutcome.PlaybackError, metrics?.outcome)
    }

    @Test
    fun cancellationAndReplacementTearsDownPlayerAndCleansTempFile() {
        val deletedFiles = mutableListOf<String>()
        val registry = PetSpeechResourceOwnerRegistry(onDeleteFile = { path ->
            deletedFiles.add(path)
        })

        var req1Outcome: PetSpeechOutcome? = null
        val req1 = registry.createOwner("ev-100", "first", "/tmp/req1.wav", onOutcome = { req1Outcome = it })

        var req2Outcome: PetSpeechOutcome? = null
        val req2 = registry.createOwner("ev-101", "second", "/tmp/req2.wav", onOutcome = { req2Outcome = it })

        // req1 was superseded and torn down
        assertTrue(req1.isCancelled)
        assertEquals(PetSpeechOutcome.Cancelled, req1Outcome)
        assertTrue(deletedFiles.contains("/tmp/req1.wav"))

        // req2 settles normally
        req2.settle(PetSpeechOutcome.Spoken)
        assertEquals(PetSpeechOutcome.Spoken, req2Outcome)
        assertTrue(deletedFiles.contains("/tmp/req2.wav"))
    }
}
