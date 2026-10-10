import { defineMethod } from '../../core'
import { TerminalSwitchOrigin } from '../../../../../shared/rpc-contract/terminal-originating-pane-params'
import {
  navigationTargetsHost,
  resolveRuntimeNavigationTarget
} from '../../../../../shared/runtime-navigation'
import { TERMINAL_ORIGINATING_PANE_NAVIGATION_RUNTIME_CAPABILITY } from '../../../../../shared/terminal-navigation-runtime-capabilities'

export const TERMINAL_ORIGINATING_PANE_METHODS = [
  defineMethod({
    name: 'terminal.switchOrigin',
    permission: 'workspace',
    params: TerminalSwitchOrigin,
    handler: async (params, { runtime, clientKind, clientCapabilities, signal }) => {
      if (
        clientKind !== undefined &&
        !clientCapabilities?.includes(TERMINAL_ORIGINATING_PANE_NAVIGATION_RUNTIME_CAPABILITY)
      ) {
        throw new Error('session_navigation_unavailable')
      }
      if (
        !navigationTargetsHost(
          resolveRuntimeNavigationTarget({ navigation: params.navigation, clientKind })
        )
      ) {
        throw new Error('session_navigation_host_required')
      }
      signal?.throwIfAborted()
      const navigation = await runtime.switchOriginatingPane(
        {
          provider: params.provider,
          session: params.session,
          ...(params.workspace ? { workspace: params.workspace } : {})
        },
        { activateHostWindow: clientKind === undefined }
      )
      signal?.throwIfAborted()
      return { navigation }
    }
  })
]
