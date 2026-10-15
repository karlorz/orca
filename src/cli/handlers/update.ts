import type { CommandHandler } from '../dispatch'
import { printResult } from '../format'
import {
  applyHomeAppImageUpdate,
  checkHomeAppImageUpdate,
  formatHomeUpdateApply,
  formatHomeUpdateCheck,
  homeAppImageCliUpdateSession
} from '../home-appimage-cli-update'
import { rejectRemoteSelectionFlags } from '../remote-selection-flag-rejection'
import type { RuntimeRpcSuccess } from '../runtime-client'

const REMOTE_SELECTION_SUFFIX =
  'home AppImage updates; they apply to this machine’s Linux home install.'

function localSuccess<TResult>(result: TResult): RuntimeRpcSuccess<TResult> {
  return {
    id: 'local',
    ok: true,
    result,
    _meta: { runtimeId: 'local' }
  }
}

export const UPDATE_HANDLERS: Record<string, CommandHandler> = {
  'update check': async ({ flags, json }) => {
    rejectRemoteSelectionFlags(flags, REMOTE_SELECTION_SUFFIX)
    const result = await checkHomeAppImageUpdate(await homeAppImageCliUpdateSession())
    printResult(localSuccess(result), json, formatHomeUpdateCheck)
  },
  'update apply': async ({ flags, json }) => {
    rejectRemoteSelectionFlags(flags, REMOTE_SELECTION_SUFFIX)
    const result = await applyHomeAppImageUpdate(await homeAppImageCliUpdateSession())
    printResult(localSuccess(result), json, formatHomeUpdateApply)
  }
}
