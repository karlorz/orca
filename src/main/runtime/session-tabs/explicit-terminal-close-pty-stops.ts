import { OrcaRuntimeWithFocusTerminal } from '../terminal/focus/focus-terminal'
import { EXPLICIT_TERMINAL_CLOSE_STOP_TIMEOUT_MS } from '../orca-runtime-core'
import { SSH_PROVIDER_UNREGISTERED_REASON } from '../../../shared/pty-liveness-verdict'
import { errorMessage } from '../../../shared/error-message'

/** How an explicit close's stop of its addressed PTY ended. */
export type ExplicitCloseStop = { stopped: boolean }

export const NO_STOP: ExplicitCloseStop = { stopped: false }

export abstract class OrcaRuntimeWithExplicitCloseTabPtyStops extends OrcaRuntimeWithFocusTerminal {
  protected async stopExplicitlyClosedTabPtys(
    ptyIds: readonly string[],
    addressedPtyId: string,
    capturedIncarnations?: ReadonlyMap<string, string>
  ): Promise<ExplicitCloseStop> {
    let addressedPtyStop = NO_STOP
    const deadlineMs = Date.now() + EXPLICIT_TERMINAL_CLOSE_STOP_TIMEOUT_MS
    for (const ptyId of ptyIds) {
      const capturedIncarnationId = capturedIncarnations?.get(ptyId)
      const liveIncarnationId = this.ptysById.get(ptyId)?.incarnationId
      if (capturedIncarnationId && liveIncarnationId !== capturedIncarnationId) {
        if (ptyId === addressedPtyId) {
          throw new Error('terminal_handle_stale')
        }
        continue
      }
      this.markPtyStopRequested(ptyId)
      const expectedIncarnationId = capturedIncarnationId ?? liveIncarnationId
      const stopOpts = expectedIncarnationId
        ? { deadlineMs, expectedIncarnationId }
        : { deadlineMs }
      let stopped = false
      if (this.ptyController?.stopAndWait) {
        try {
          stopped = await this.ptyController.stopAndWait(ptyId, stopOpts)
        } catch (error) {
          this.markPtyLivenessUnverifiable(ptyId, errorMessage(error))
        }
        const liveAfterWait = this.ptysById.get(ptyId)?.incarnationId
        if (expectedIncarnationId && liveAfterWait !== expectedIncarnationId) {
          if (ptyId === addressedPtyId) {
            throw new Error('terminal_handle_stale')
          }
          continue
        }
        // Preserve an observed exit when a broader inventory check could not finish.
        if (
          !stopped &&
          expectedIncarnationId &&
          liveAfterWait === expectedIncarnationId &&
          this.getPtyLivenessVerdict(ptyId)?.status === 'exited'
        ) {
          stopped = true
        }
        if (!stopped) {
          const verdict = this.getPtyLivenessVerdict(ptyId)
          const providerAlreadyRetiredPty =
            verdict?.status === 'unverifiable' &&
            verdict.reason === SSH_PROVIDER_UNREGISTERED_REASON
          if (!providerAlreadyRetiredPty) {
            this.ptyController.kill(ptyId, {
              expectedIncarnationId: expectedIncarnationId ?? undefined
            })
            if (!verdict || verdict.status === 'live') {
              this.markPtyLivenessUnverifiable(
                ptyId,
                'a follow-up stop was issued but its outcome could not be verified'
              )
            }
          }
        }
      } else {
        stopped = this.ptyController?.kill(ptyId, {
          expectedIncarnationId: expectedIncarnationId ?? undefined
        }) ?? false
      }
      if (ptyId === addressedPtyId) {
        addressedPtyStop = { stopped }
      }
    }
    return addressedPtyStop
  }
}
