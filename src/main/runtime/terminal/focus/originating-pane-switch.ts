import {
  switchOriginatingPaneWithHost,
  type OriginatingPaneNavigationReceipt,
  type OriginatingPaneTarget
} from '../../terminal-originating-pane-navigation'
import { originatingPaneRuntimeHost } from './originating-pane-runtime-host'
import { OrcaRuntimeWithFocusTerminal } from './focus-terminal'

export abstract class OrcaRuntimeWithOriginatingPaneSwitch extends OrcaRuntimeWithFocusTerminal {
  async switchOriginatingPane(
    target: OriginatingPaneTarget,
    options: { activateHostWindow?: boolean } = {}
  ): Promise<OriginatingPaneNavigationReceipt> {
    return switchOriginatingPaneWithHost(
      originatingPaneRuntimeHost({
        getAgentStatusSnapshotFn: this.getAgentStatusSnapshotFn,
        readObservedAgentStatusPaneIdentityFn: (paneKey) =>
          this.readObservedAgentStatusPaneIdentityFn(paneKey),
        getLivePtyForHandle: (handle) => this.getLivePtyForHandle(handle),
        getLivePtyForRetainedHandle: (handle) => this.getLivePtyForRetainedHandle(handle),
        assertGraphReady: () => this.assertGraphReady(),
        leaves: this.leaves,
        getLeafKey: (tabId, leafId) => this.getLeafKey(tabId, leafId),
        resolveWorktreeSelector: (selector) => this.resolveWorktreeSelector(selector),
        focusTerminal: (handle, focusOptions) => this.focusTerminal(handle, focusOptions)
      }),
      target,
      options
    )
  }
}
