import { defineMethod } from '../../core'
import { agentHookServer } from '../../../../agent-hooks/server'
import { TerminalSessionNavigation } from '../../../terminal-session-navigation'
import {
  TerminalResolveSession,
  TerminalSwitchSession
} from '../../../../../shared/rpc-contract/terminal-session-navigation-params'
import {
  navigationTargetsHost,
  resolveRuntimeNavigationTarget
} from '../../../../../shared/runtime-navigation'

export const TERMINAL_SESSION_NAVIGATION_METHODS = [
  defineMethod({
    name: 'terminal.resolveSession',
    params: TerminalResolveSession,
    handler: async (params, { runtime }) => ({
      binding: new TerminalSessionNavigation({
        observations: () => agentHookServer.getGrokSessionObservations(),
        owner: (paneKey) => runtime.getSessionTerminalOwner(paneKey),
        reveal: (binding, stillCurrent) => runtime.revealSessionTerminal(binding, stillCurrent)
      }).resolve(params.session)
    })
  }),
  defineMethod({
    name: 'terminal.switchSession',
    params: TerminalSwitchSession,
    handler: async (params, { runtime, clientKind }) => {
      if (
        !navigationTargetsHost(
          resolveRuntimeNavigationTarget({ navigation: params.navigation, clientKind })
        )
      ) {
        throw new Error('session_navigation_host_required')
      }
      // Why: an undefined clientKind is the execution-host CLI; a paired caller navigates without raising the host window.
      const activateHostWindow = clientKind === undefined
      return {
        navigation: await new TerminalSessionNavigation({
          observations: () => agentHookServer.getGrokSessionObservations(),
          owner: (paneKey) => runtime.getSessionTerminalOwner(paneKey),
          reveal: (binding, stillCurrent) =>
            runtime.revealSessionTerminal(binding, stillCurrent, { activateHostWindow })
        }).navigate(params.session)
      }
    }
  })
]
