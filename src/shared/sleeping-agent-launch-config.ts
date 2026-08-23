import type { SleepingAgentLaunchConfig } from './agent-session-resume'
import {
  DEFAULT_REMOTE_CODEX_HOOK_LAUNCH_ENV,
  hasPlannedRemoteCodexHookFeatureArgs
} from './codex-remote-hook-launch'

export function buildSleepingAgentLaunchConfig(args: {
  agentCommand?: string | null
  agentArgs?: string | null
  agentEnv?: Record<string, string> | null
  ompResumeFilePath?: string | null
}): SleepingAgentLaunchConfig {
  return {
    ...(args.agentCommand?.trim() ? { agentCommand: args.agentCommand } : {}),
    agentArgs: args.agentArgs ?? '',
    // Why: startup env may include prompt transport or pane identity values;
    // durable resume state is limited to Orca-managed agent inputs.
    agentEnv: {
      ...args.agentEnv,
      ...(args.agentCommand &&
        hasPlannedRemoteCodexHookFeatureArgs(args.agentCommand) &&
        DEFAULT_REMOTE_CODEX_HOOK_LAUNCH_ENV)
    },
    ...(args.ompResumeFilePath?.trim() ? { ompResumeFilePath: args.ompResumeFilePath.trim() } : {})
  }
}
