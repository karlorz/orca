import { tokenizeStartupCommand, type AgentStartupShell } from './tui-agent-startup-shell'
import type { TuiAgent } from './tui-agent'

export const REMOTE_CODEX_HOOK_ENABLE_ARG_ENV = 'ORCA_CODEX_HOOK_ENABLE_ARG'
export const REMOTE_CODEX_HOOK_FEATURE_ARG_ENV = 'ORCA_CODEX_HOOK_FEATURE_ARG'
export const REMOTE_CODEX_HOOK_FEATURE_ARGS = `$${REMOTE_CODEX_HOOK_ENABLE_ARG_ENV} $${REMOTE_CODEX_HOOK_FEATURE_ARG_ENV}`

export const DEFAULT_REMOTE_CODEX_HOOK_LAUNCH_ENV = {
  [REMOTE_CODEX_HOOK_ENABLE_ARG_ENV]: '-c',
  [REMOTE_CODEX_HOOK_FEATURE_ARG_ENV]: 'features.hooks=false'
} as const

function isHooksConfigOverride(token: string): boolean {
  return /^(?:-c=?|--config=?)features\.hooks\s*=/.test(token)
}

function hasHooksFeatureOverride(tokens: readonly string[], stopAtTerminator: boolean): boolean {
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (stopAtTerminator && token === '--') {
      return false
    }
    const next = tokens[index + 1]
    if (
      ((token === '--enable' || token === '--disable') && next === 'hooks') ||
      token === '--enable=hooks' ||
      token === '--disable=hooks' ||
      ((token === '-c' || token === '--config') && /^features\.hooks\s*=/.test(next ?? '')) ||
      isHooksConfigOverride(token)
    ) {
      return true
    }
  }
  return false
}

function isCodexExecutable(token: string): boolean {
  return /(?:^|[\\/])codex(?:\.exe)?$/i.test(token)
}

function isMiseExecutable(token: string): boolean {
  return /(?:^|[\\/])mise(?:\.exe)?$/i.test(token)
}

function commandHookArgStart(tokens: readonly string[]): number | null {
  if (isCodexExecutable(tokens[0] ?? '')) {
    return 1
  }
  const codexIndex = tokens.findIndex(isCodexExecutable)
  if (
    codexIndex >= 3 &&
    isMiseExecutable(tokens[0] ?? '') &&
    tokens[1] === 'exec' &&
    tokens[codexIndex - 1] === '--' &&
    tokens.slice(2, codexIndex - 1).every((token) => token.startsWith('-'))
  ) {
    return codexIndex + 1
  }
  return null
}

function commandHasHooksFeatureOverride(tokens: readonly string[], argStart: number): boolean {
  return hasHooksFeatureOverride(tokens.slice(argStart), true)
}

function commandHasPlannedHookFeatureArgs(
  command: string,
  tokenized: Extract<ReturnType<typeof tokenizeStartupCommand>, { ok: true }>,
  argStart: number
): boolean {
  const terminatorIndex = tokenized.tokens.indexOf('--', argStart)
  const divergentIndex = tokenized.spans.findIndex(
    (span, index) => index >= argStart && span.divergesFromShell
  )
  const boundary = Math.min(
    terminatorIndex === -1 ? tokenized.tokens.length : terminatorIndex,
    divergentIndex === -1 ? tokenized.tokens.length : divergentIndex
  )
  const enableArg = `$${REMOTE_CODEX_HOOK_ENABLE_ARG_ENV}`
  const featureArg = `$${REMOTE_CODEX_HOOK_FEATURE_ARG_ENV}`
  for (let index = argStart; index + 1 < boundary; index += 1) {
    const enableSpan = tokenized.spans[index]
    const featureSpan = tokenized.spans[index + 1]
    if (
      command.slice(enableSpan.start, enableSpan.end) === enableArg &&
      command.slice(featureSpan.start, featureSpan.end) === featureArg
    ) {
      return true
    }
  }
  return false
}

export function hasPlannedRemoteCodexHookFeatureArgs(command: string): boolean {
  const tokenized = tokenizeStartupCommand(command, 'posix')
  if (!tokenized.ok) {
    return false
  }
  const argStart = commandHookArgStart(tokenized.tokens)
  return argStart !== null && commandHasPlannedHookFeatureArgs(command, tokenized, argStart)
}

function insertHookFeatureArgs(command: string, shell: AgentStartupShell): string | null {
  const tokenized = tokenizeStartupCommand(command, shell)
  if (!tokenized.ok) {
    return null
  }
  const argStart = commandHookArgStart(tokenized.tokens)
  if (argStart === null) {
    return null
  }
  const terminatorIndex = tokenized.tokens.indexOf('--', argStart)
  const divergentIndex = tokenized.spans.findIndex(
    (span, index) => index >= argStart && span.divergesFromShell
  )
  const insertionTokenIndex =
    terminatorIndex === -1
      ? divergentIndex === -1
        ? tokenized.tokens.length
        : divergentIndex
      : divergentIndex === -1
        ? terminatorIndex
        : Math.min(terminatorIndex, divergentIndex)
  if (tokenized.spans.slice(0, insertionTokenIndex).some((span) => span.divergesFromShell)) {
    return null
  }
  const insertionOffset =
    insertionTokenIndex < tokenized.spans.length
      ? tokenized.spans[insertionTokenIndex].start
      : command.length
  const before = command.slice(0, insertionOffset).trimEnd()
  const after = command.slice(insertionOffset).trimStart()
  return [before, REMOTE_CODEX_HOOK_FEATURE_ARGS, after].filter(Boolean).join(' ')
}

export type RemoteCodexHookLaunchContext = {
  command: string
  env?: Record<string, string>
}

export function planRemoteCodexHookLaunchContext(args: {
  agent: TuiAgent
  command: string
  shell: AgentStartupShell
  isRemote?: boolean
  trailingTokens?: readonly string[]
}): RemoteCodexHookLaunchContext {
  if (args.agent !== 'codex' || args.isRemote !== true || args.shell !== 'posix') {
    return { command: args.command }
  }
  const tokenized = tokenizeStartupCommand(args.command, args.shell)
  const argStart = tokenized.ok ? commandHookArgStart(tokenized.tokens) : null
  if (
    !tokenized.ok ||
    argStart === null ||
    commandHasHooksFeatureOverride(tokenized.tokens, argStart) ||
    hasHooksFeatureOverride(args.trailingTokens ?? [], true)
  ) {
    return { command: args.command }
  }
  const command = commandHasPlannedHookFeatureArgs(args.command, tokenized, argStart)
    ? args.command
    : insertHookFeatureArgs(args.command, args.shell)
  if (!command) {
    return { command: args.command }
  }
  return { command, env: { ...DEFAULT_REMOTE_CODEX_HOOK_LAUNCH_ENV } }
}
