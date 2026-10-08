import { AGENT_LAUNCH_RUNTIME_CAPABILITIES } from './agent-launch-runtime-capability'

// Why a separate module: protocol-version.ts sits at its max-lines ceiling, so these fork
// terminal navigation/question capabilities live here and ride the tail of RUNTIME_CAPABILITIES
// together with upstream's agent-launch list (one spread line in protocol-version.ts).
export const TERMINAL_SESSION_NAVIGATION_RUNTIME_CAPABILITY =
  'terminal.session-navigation.v1' as const
export const TERMINAL_ORIGINATING_PANE_NAVIGATION_RUNTIME_CAPABILITY =
  'terminal.originating-pane-navigation.v1' as const
export const TERMINAL_QUESTION_ANSWER_RUNTIME_CAPABILITY = 'terminal.question-answer.v1' as const

export const TERMINAL_NAVIGATION_RUNTIME_CAPABILITIES = [
  TERMINAL_SESSION_NAVIGATION_RUNTIME_CAPABILITY,
  TERMINAL_ORIGINATING_PANE_NAVIGATION_RUNTIME_CAPABILITY,
  TERMINAL_QUESTION_ANSWER_RUNTIME_CAPABILITY
] as const

export const FORK_TERMINAL_AND_AGENT_LAUNCH_RUNTIME_CAPABILITIES = [
  ...TERMINAL_NAVIGATION_RUNTIME_CAPABILITIES,
  ...AGENT_LAUNCH_RUNTIME_CAPABILITIES
] as const
