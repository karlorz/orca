package expo.modules.petspeech

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class PetSpeechBootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context?, intent: Intent?) {
        if (context == null) {
            return
        }
        if (!PetSpeechBootResumeDecision.isBootAction(intent?.action)) {
            return
        }
        val prefs = PetSpeechPersistPrefs.read(context)
        val decision = PetSpeechBootResumeDecision.decide(
            persistEnabled = prefs.persistEnabled,
            masterEnabled = prefs.masterEnabled,
            keepWhenNoHost = prefs.keepWhenNoHost,
            overlayWhileSpeaking = prefs.overlayWhileSpeaking
        )
        if (decision.postResumeNotification) {
            PetSpeechNotificationCoordinator.applyPlan(
                context,
                PetSpeechBootResumeDecision.notificationPlan(
                    persistEnabled = prefs.persistEnabled,
                    masterEnabled = prefs.masterEnabled
                ),
                resumeTitle = PetSpeechNotificationCoordinator.BOOT_RESUME_TITLE,
                resumeText = PetSpeechNotificationCoordinator.BOOT_RESUME_TEXT
            )
        }
    }
}
