import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

const HOME_NOTE =
  'Updates the Linux home AppImage under ~/.local/opt/orca using the same feed, selection, SHA256, and daemon-protocol policy as the in-app updater. Does not retarget a paired Orca server (`orca environment update`).'
const APPLY_NOTE =
  'apply downloads and commits the selected pin. It never relaunches Orca and never installs an older or equal tag.'

export const UPDATE_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['update', 'check'],
    summary: 'Check the Linux home AppImage feed for a newer pin',
    usage: 'orca update check [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    notes: [HOME_NOTE],
    examples: ['orca update check', 'orca update check --json']
  },
  {
    path: ['update', 'apply'],
    summary: 'Download and commit a newer Linux home AppImage pin',
    usage: 'orca update apply [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    notes: [HOME_NOTE, APPLY_NOTE],
    examples: ['orca update apply', 'orca update apply --json']
  }
]
