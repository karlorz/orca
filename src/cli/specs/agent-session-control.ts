import { GLOBAL_FLAGS, type CommandSpec } from '../args'

export const AGENT_SESSION_CONTROL_COMMAND_SPECS: CommandSpec[] = [
  ['control-target', 'Resolve an existing managed Grok session without starting one'],
  ['follow-up', 'Send one strict follow-up to an exact managed Grok target'],
  ['stop', 'Stop the exact bound Grok turn and report observed completion']
].map(([command, summary]) => ({
  path: ['agent-session', command],
  summary,
  usage: `orca agent-session ${command} --request-file <path|-> [--json]`,
  allowedFlags: [...GLOBAL_FLAGS, 'request', 'request-file'],
  notes: [
    'Exactly one JSON input: --request structured argv or --request-file path; - reads stdin.',
    'Use --environment or --pairing-code for the executing runtime. Missing capability fails closed.'
  ],
  examples: [`orca agent-session ${command} --request-file - --json`]
}))
