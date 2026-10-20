import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

export const APP_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['claude-teams'],
    argumentMode: 'passthrough',
    summary: 'Start Claude Code Agent Teams in the current Orca terminal',
    usage: 'orca claude-teams [claude args...]',
    allowedFlags: [...GLOBAL_FLAGS],
    notes: [
      'Passes all following arguments through to Claude Code after enabling Agent Teams native panes.',
      'Must be run from inside an Orca terminal. Starts Claude Code Agent Teams in the current pane and opens teammates as native Orca splits.'
    ],
    examples: ['orca claude-teams', 'orca claude-teams --resume <session-id>']
  }
]
