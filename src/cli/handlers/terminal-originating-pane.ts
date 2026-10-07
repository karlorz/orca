import type { CommandHandler } from '../dispatch'
import { getOptionalStringFlag, getRequiredStringFlag } from '../flags'
import { printResult } from '../format'
import { RuntimeClientError } from '../runtime-client'
import { TERMINAL_ORIGINATING_PANE_NAVIGATION_RUNTIME_CAPABILITY } from '../../shared/protocol-version'
import { TerminalSwitchOrigin } from '../../shared/rpc-contract/terminal-originating-pane-params'

export const terminalSwitchOriginHandler: CommandHandler = async ({ flags, client, json }) => {
  const workspace = getOptionalStringFlag(flags, 'workspace')
  const parsed = TerminalSwitchOrigin.safeParse({
    provider: getRequiredStringFlag(flags, 'provider'),
    session: getRequiredStringFlag(flags, 'session'),
    ...(workspace !== undefined ? { workspace } : {}),
    navigation: 'host'
  })
  if (!parsed.success) {
    throw new RuntimeClientError('invalid_argument', 'Invalid originating provider session.')
  }
  const status = await client.getCliStatus()
  if (
    !status.result.runtime.capabilities?.includes(
      TERMINAL_ORIGINATING_PANE_NAVIGATION_RUNTIME_CAPABILITY
    )
  ) {
    throw new RuntimeClientError('session_navigation_unavailable', 'session_navigation_unavailable')
  }
  const result = await client.call('terminal.switchOrigin', parsed.data)
  printResult(
    result,
    json,
    () => 'Originating pane selection acknowledged; window and pane focus are reported separately.'
  )
}
