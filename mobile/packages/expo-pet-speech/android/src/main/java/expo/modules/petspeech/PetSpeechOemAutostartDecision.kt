package expo.modules.petspeech

object PetSpeechOemAutostartDecision {
    const val MOTOROLA_DEVICE_GUARD_PACKAGE = "com.motorola.deviceguard"
    const val MOTOROLA_PORTAL_ACTIVITY = "com.motorola.deviceguard.portal.activity.PortalActivity"

    fun isForbiddenAutoRun(activityClass: String): Boolean {
        return activityClass.contains("AutoRunMainActivity")
    }
}
