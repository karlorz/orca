import type { CommandHandler } from '../dispatch'
import { getRequiredStringFlag } from '../flags'
import { printResult } from '../format'
import { RuntimeClientError } from '../runtime-client'
import { TERMINAL_SESSION_NAVIGATION_RUNTIME_CAPABILITY } from '../../shared/protocol-version'

function handler(method: string): CommandHandler {
  return async ({ flags, client, json }) => {
    const provider = getRequiredStringFlag(flags, 'provider')
    const session = getRequiredStringFlag(flags, 'session')
    if (provider !== 'grok') {
      throw new RuntimeClientError('invalid_argument', 'Only Grok session navigation is supported.')
    }
    const status = await client.getCliStatus()
    if (
      !status.result.runtime.capabilities?.includes(TERMINAL_SESSION_NAVIGATION_RUNTIME_CAPABILITY)
    ) {
      throw new RuntimeClientError(
        'session_navigation_unavailable',
        'This Orca host cannot verify exact session navigation. No navigation was attempted.'
      )
    }
    const result = await client.call(method, {
      provider,
      session,
      ...(method === 'terminal.switchSession' ? { navigation: 'host' } : {})
    })
    printResult(result, json, () =>
      method === 'terminal.switchSession'
        ? 'Verified session navigation acknowledged (window and pane focus are reported separately).'
        : 'Verified exact session binding.'
    )
  }
}

export const TERMINAL_SESSION_NAVIGATION_HANDLERS = {
  'terminal resolve-session': handler('terminal.resolveSession'),
  'terminal switch-session': handler('terminal.switchSession')
}
