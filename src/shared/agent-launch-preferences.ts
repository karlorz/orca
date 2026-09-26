import type { AgentLaunchPreferences } from './agent-session-host-authority'

/** Use one converter for every launch lane. */
export function toAgentLaunchPreferences(
  sessionOptions: Readonly<Record<string, unknown>> | null | undefined
): AgentLaunchPreferences | undefined {
  if (!sessionOptions) {
    return undefined
  }
  const readString = (key: keyof AgentLaunchPreferences): string | undefined => {
    const value = sessionOptions[key]
    return typeof value === 'string' && value.trim() ? value.trim() : undefined
  }
  const model = readString('model')
  const effort = readString('effort')
  const mode = readString('mode')
  const agentProfile = readString('agentProfile')
  const extraArgs = readString('extraArgs')
  const preferences: AgentLaunchPreferences = {
    ...(model ? { model } : {}),
    ...(effort ? { effort } : {}),
    ...(mode ? { mode } : {}),
    ...(agentProfile ? { agentProfile } : {}),
    ...(extraArgs ? { extraArgs } : {})
  }
  return Object.keys(preferences).length > 0 ? preferences : undefined
}
