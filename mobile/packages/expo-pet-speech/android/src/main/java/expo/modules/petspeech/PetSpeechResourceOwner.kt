package expo.modules.petspeech

import java.io.File
import java.util.concurrent.atomic.AtomicBoolean

class PetSpeechResourceOwner(
    val id: Long,
    val eventId: String,
    val text: String,
    val tempFilePath: String,
    private val onOutcome: (PetSpeechOutcome) -> Unit,
    private val onSettled: (PetSpeechResourceOwner) -> Unit,
    private val fileDeleter: (String) -> Unit
) {
    private val isSettled = AtomicBoolean(false)
    private val _isCancelled = AtomicBoolean(false)

    val isCancelled: Boolean
        get() = _isCancelled.get() || isSettled.get()

    private var engineLifecycle: PetSpeechEngineLifecycle<*>? = null
    private var boundServiceConnection: Any? = null
    private var unbindAction: (() -> Unit)? = null
    private var isActuallyBound = false
    private var isServiceStarted = false
    private var stopStartedServiceAction: (() -> Unit)? = null
    private var cancelSpeechAction: (() -> Unit)? = null

    fun markCancelled() {
        _isCancelled.set(true)
    }

    fun attachEngineLifecycle(lifecycle: PetSpeechEngineLifecycle<*>): Boolean {
        synchronized(this) {
            if (_isCancelled.get() || isSettled.get()) {
                lifecycle.release()
                return false
            }
            engineLifecycle = lifecycle
            return true
        }
    }

    fun markServiceStarted(stopService: () -> Unit) {
        synchronized(this) {
            isServiceStarted = true
            stopStartedServiceAction = stopService
            if (_isCancelled.get() || isSettled.get()) {
                // If cancelled before or during start registration, run stop action immediately
                stopStartedServiceAction = null
                isServiceStarted = false
                try {
                    stopService()
                } catch (_: Exception) {}
            }
        }
    }

    fun registerConnectionAttempt(connection: Any, unbind: () -> Unit) {
        synchronized(this) {
            boundServiceConnection = connection
            unbindAction = unbind
        }
    }

    fun onBindResult(bound: Boolean) {
        synchronized(this) {
            isActuallyBound = bound
            if (!bound) {
                // Connection was not established; unbindAction must not be called
                boundServiceConnection = null
                unbindAction = null
            }
        }
        if (!bound) {
            onBindFailed()
        }
    }

    fun attachBoundService(onCancelSpeech: () -> Unit) {
        synchronized(this) {
            cancelSpeechAction = onCancelSpeech
            if (_isCancelled.get() || isSettled.get()) {
                val action = cancelSpeechAction
                cancelSpeechAction = null
                try {
                    action?.invoke()
                } catch (_: Exception) {}
            }
        }
    }

    fun settle(outcome: PetSpeechOutcome): Boolean {
        if (isSettled.compareAndSet(false, true)) {
            val cleanupActions = extractTeardownActions()
            executeTeardownActions(cleanupActions)
            fileDeleter(tempFilePath)
            onOutcome(outcome)
            onSettled(this)
            return true
        }
        return false
    }

    fun onBindFailed() {
        settle(PetSpeechOutcome.PlaybackError)
    }

    fun onServiceConnectFailed() {
        settle(PetSpeechOutcome.PlaybackError)
    }

    fun onServiceDisconnected() {
        settle(PetSpeechOutcome.Cancelled)
    }

    fun teardown() {
        _isCancelled.set(true)
        if (isSettled.compareAndSet(false, true)) {
            val cleanupActions = extractTeardownActions()
            executeTeardownActions(cleanupActions)
            fileDeleter(tempFilePath)
            onOutcome(PetSpeechOutcome.Cancelled)
            onSettled(this)
        } else {
            val cleanupActions = extractTeardownActions()
            executeTeardownActions(cleanupActions)
        }
    }

    private data class TeardownActions(
        val engine: PetSpeechEngineLifecycle<*>?,
        val unbind: (() -> Unit)?,
        val stopService: (() -> Unit)?,
        val cancelSpeech: (() -> Unit)?
    )

    private fun extractTeardownActions(): TeardownActions {
        synchronized(this) {
            val engine = engineLifecycle
            engineLifecycle = null

            val unbind = if (isActuallyBound) unbindAction else null
            isActuallyBound = false
            unbindAction = null
            boundServiceConnection = null

            val stopService = if (isServiceStarted) stopStartedServiceAction else null
            isServiceStarted = false
            stopStartedServiceAction = null

            val cancelSpeech = cancelSpeechAction
            cancelSpeechAction = null

            return TeardownActions(engine, unbind, stopService, cancelSpeech)
        }
    }

    private fun executeTeardownActions(actions: TeardownActions) {
        try {
            actions.engine?.release()
        } catch (_: Exception) {}

        try {
            actions.cancelSpeech?.invoke()
        } catch (_: Exception) {}

        try {
            actions.unbind?.invoke()
        } catch (_: Exception) {}

        try {
            actions.stopService?.invoke()
        } catch (_: Exception) {}
    }
}

class PetSpeechResourceOwnerRegistry(
    private val onDeleteFile: (String) -> Unit = { path ->
        try {
            val file = File(path)
            if (file.exists()) {
                file.delete()
            }
        } catch (_: Exception) {}
    }
) {
    private var sequenceNumber = 0L
    private var currentOwner: PetSpeechResourceOwner? = null

    fun createOwner(
        eventId: String,
        text: String,
        tempFilePath: String,
        onOutcome: (PetSpeechOutcome) -> Unit
    ): PetSpeechResourceOwner {
        val prev: PetSpeechResourceOwner?
        val newOwner: PetSpeechResourceOwner

        synchronized(this) {
            prev = currentOwner
            val id = ++sequenceNumber

            newOwner = PetSpeechResourceOwner(
                id = id,
                eventId = eventId,
                text = text,
                tempFilePath = tempFilePath,
                onOutcome = onOutcome,
                onSettled = { settled ->
                    synchronized(this) {
                        if (currentOwner === settled) {
                            currentOwner = null
                        }
                    }
                },
                fileDeleter = onDeleteFile
            )
            currentOwner = newOwner
        }

        // Run teardown outside registry monitor lock to prevent lock reentrancy or deadlock
        prev?.teardown()
        return newOwner
    }

    fun isCurrent(owner: PetSpeechResourceOwner): Boolean {
        synchronized(this) {
            return currentOwner === owner && !owner.isCancelled
        }
    }

    fun stopAll() {
        val prev: PetSpeechResourceOwner?
        synchronized(this) {
            prev = currentOwner
            currentOwner = null
        }
        prev?.teardown()
    }
}
