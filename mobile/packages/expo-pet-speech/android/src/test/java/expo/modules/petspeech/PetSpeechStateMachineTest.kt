package expo.modules.petspeech

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PetSpeechStateMachineTest {

    @Test
    fun normalLifecycleExecutesInStrictOrder() {
        val actions = mutableListOf<PetSpeechStateMachine.Action>()
        val sm = PetSpeechStateMachine { action -> actions.add(action) }

        sm.onStartSynthesis("ev-1", "你好呀", "/tmp/audio.wav")
        assertTrue(sm.currentState is PetSpeechState.Synthesizing)

        sm.onSynthesisSuccess()
        assertEquals(
            listOf(
                PetSpeechStateMachine.Action.RequestAudioFocus
            ),
            actions
        )

        actions.clear()
        sm.onAudioFocusGranted()
        assertTrue(sm.currentState is PetSpeechState.Playing)
        assertEquals(
            listOf(
                PetSpeechStateMachine.Action.PlayAudioFile("/tmp/audio.wav")
            ),
            actions
        )

        actions.clear()
        sm.onPlaybackComplete()
        assertEquals(
            listOf(
                PetSpeechStateMachine.Action.AbandonAudioFocus,
                PetSpeechStateMachine.Action.StopForeground,
                PetSpeechStateMachine.Action.DeleteTempFile("/tmp/audio.wav"),
                PetSpeechStateMachine.Action.NotifyOutcome("ev-1", PetSpeechOutcome.Spoken)
            ),
            actions
        )
        assertEquals(PetSpeechState.Idle, sm.currentState)
    }

    @Test
    fun audioFocusDeniedCancelsPlaybackImmediately() {
        val actions = mutableListOf<PetSpeechStateMachine.Action>()
        val sm = PetSpeechStateMachine { action -> actions.add(action) }

        sm.onStartSynthesis("ev-1-focus-fail", "無焦點", "/tmp/nofocus.wav")
        sm.onSynthesisSuccess()
        actions.clear()

        sm.onAudioFocusDenied()
        assertEquals(
            listOf(
                PetSpeechStateMachine.Action.StopForeground,
                PetSpeechStateMachine.Action.DeleteTempFile("/tmp/nofocus.wav"),
                PetSpeechStateMachine.Action.NotifyOutcome("ev-1-focus-fail", PetSpeechOutcome.Cancelled)
            ),
            actions
        )
        assertEquals(PetSpeechState.Idle, sm.currentState)
    }

    @Test
    fun synthesisFailureCleansUpAndNotifies() {
        val actions = mutableListOf<PetSpeechStateMachine.Action>()
        val sm = PetSpeechStateMachine { action -> actions.add(action) }

        sm.onStartSynthesis("ev-2", "失敗測試", "/tmp/fail.wav")
        sm.onSynthesisFailed(PetSpeechOutcome.PlaybackError)

        assertEquals(
            listOf(
                PetSpeechStateMachine.Action.DeleteTempFile("/tmp/fail.wav"),
                PetSpeechStateMachine.Action.NotifyOutcome("ev-2", PetSpeechOutcome.PlaybackError)
            ),
            actions
        )
        assertEquals(PetSpeechState.Idle, sm.currentState)
    }

    @Test
    fun playbackErrorCleansUpTeardownAndNotifies() {
        val actions = mutableListOf<PetSpeechStateMachine.Action>()
        val sm = PetSpeechStateMachine { action -> actions.add(action) }

        sm.onStartSynthesis("ev-3", "播放出錯", "/tmp/err.wav")
        sm.onSynthesisSuccess()
        sm.onAudioFocusGranted()
        actions.clear()

        sm.onPlaybackError()
        assertEquals(
            listOf(
                PetSpeechStateMachine.Action.AbandonAudioFocus,
                PetSpeechStateMachine.Action.StopForeground,
                PetSpeechStateMachine.Action.DeleteTempFile("/tmp/err.wav"),
                PetSpeechStateMachine.Action.NotifyOutcome("ev-3", PetSpeechOutcome.PlaybackError)
            ),
            actions
        )
        assertEquals(PetSpeechState.Idle, sm.currentState)
    }

    @Test
    fun audioFocusLossCancelsAndCleansUp() {
        val actions = mutableListOf<PetSpeechStateMachine.Action>()
        val sm = PetSpeechStateMachine { action -> actions.add(action) }

        sm.onStartSynthesis("ev-4", "焦點丟失", "/tmp/focus.wav")
        sm.onSynthesisSuccess()
        sm.onAudioFocusGranted()
        actions.clear()

        sm.onAudioFocusLost()
        assertEquals(
            listOf(
                PetSpeechStateMachine.Action.AbandonAudioFocus,
                PetSpeechStateMachine.Action.StopForeground,
                PetSpeechStateMachine.Action.DeleteTempFile("/tmp/focus.wav"),
                PetSpeechStateMachine.Action.NotifyOutcome("ev-4", PetSpeechOutcome.Cancelled)
            ),
            actions
        )
        assertEquals(PetSpeechState.Idle, sm.currentState)
    }

    @Test
    fun cancelDuringPlaybackCleansUp() {
        val actions = mutableListOf<PetSpeechStateMachine.Action>()
        val sm = PetSpeechStateMachine { action -> actions.add(action) }

        sm.onStartSynthesis("ev-5", "中途取消", "/tmp/cancel.wav")
        sm.onSynthesisSuccess()
        sm.onAudioFocusGranted()
        actions.clear()

        sm.onCancel()
        assertEquals(
            listOf(
                PetSpeechStateMachine.Action.AbandonAudioFocus,
                PetSpeechStateMachine.Action.StopForeground,
                PetSpeechStateMachine.Action.DeleteTempFile("/tmp/cancel.wav"),
                PetSpeechStateMachine.Action.NotifyOutcome("ev-5", PetSpeechOutcome.Cancelled)
            ),
            actions
        )
        assertEquals(PetSpeechState.Idle, sm.currentState)
    }

    @Test
    fun serviceDestroyedDuringPlaybackCleansUp() {
        val actions = mutableListOf<PetSpeechStateMachine.Action>()
        val sm = PetSpeechStateMachine { action -> actions.add(action) }

        sm.onStartSynthesis("ev-6", "銷毀服務", "/tmp/destroy.wav")
        sm.onSynthesisSuccess()
        sm.onAudioFocusGranted()
        actions.clear()

        sm.onServiceDestroyed()
        assertEquals(
            listOf(
                PetSpeechStateMachine.Action.AbandonAudioFocus,
                PetSpeechStateMachine.Action.StopForeground,
                PetSpeechStateMachine.Action.DeleteTempFile("/tmp/destroy.wav"),
                PetSpeechStateMachine.Action.NotifyOutcome("ev-6", PetSpeechOutcome.Cancelled)
            ),
            actions
        )
        assertEquals(PetSpeechState.Idle, sm.currentState)
    }
}

