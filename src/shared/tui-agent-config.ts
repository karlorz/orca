import type { TuiAgent } from './tui-agent'
import { getOrcaCliCommandNameForPlatform } from './orca-cli-command-name'

export type AgentPromptInjectionMode =
  | 'argv'
  | 'flag-prompt'
  | 'flag-prompt-interactive'
  | 'flag-interactive'
  | 'hermes-query'
  | 'stdin-after-start'

export type DraftPasteReadySignal =
  | 'render-quiet-after-bracketed-paste'
  | 'codex-composer-prompt'
  | 'render-cursor-after-bracketed-paste'
  | 'grok-composer-prompt'

export type TuiAgentDetectionRuntime = NodeJS.Platform | 'wsl'

export type TuiAgentConfig = {
  detectCmd: string
  // Additional executable names that identify the same agent on PATH.
  detectCmdAliases?: readonly string[]
  // Other commands that must also be present before this agent counts as installed.
  detectRequiredCommands?: readonly string[]
  // Detection runtimes where this launch mode is not available as a detected agent.
  detectUnsupportedRuntimes?: readonly TuiAgentDetectionRuntime[]
  launchCmd: string
  // Platform-specific launch command when the public binary name differs.
  launchCmdByPlatform?: Partial<Record<NodeJS.Platform, string>>
  expectedProcess: string
  promptInjectionMode: AgentPromptInjectionMode
  // Option terminator required before positional prompts that may look like CLI syntax.
  argvPromptSeparator?: '--'
  // Native CLI flag that seeds the input without submitting (e.g. Claude's `--prefill`); preferred over the paste-after-ready path.
  draftPromptFlag?: string
  // Startup env var that seeds the input without submitting, for agents with no `--prefill`-style flag (e.g. pi).
  draftPromptEnvVar?: string
  // Pre-write a trust artifact so the agent's first-launch "trust this folder?" menu doesn't consume the paste.
  preflightTrust?: 'cursor' | 'copilot' | 'codex'
  // Agent-specific signal that the composer is ready for paste, stronger than the default quiet-render window.
  draftPasteReadySignal?: DraftPasteReadySignal
  // Hard deadline for the agent's composer readiness signal.
  draftPasteReadyTimeoutMs?: number
  // Windows Shift+Enter encoding override; omitted agents keep the legacy Esc+CR path.
  windowsShiftEnterEncoding?: 'csi-u'
  // Paste newlines for TUIs that read Windows console input records instead of VT paste frames.
  windowsInputRecordPasteNewline?: 'alt-enter' | 'csi-u'
  // Ctrl+Enter encoding for agents that consume CSI-u without active kitty flags.
  ctrlEnterEncoding?: 'csi-u'
}

export const TUI_AGENT_CONFIG: Record<TuiAgent, TuiAgentConfig> = {
  claude: {
    detectCmd: 'claude',
    launchCmd: 'claude',
    expectedProcess: 'claude',
    promptInjectionMode: 'argv',
    // Why: `claude --prefill <text>` seeds the input without submitting, avoiding the paste-after-ready race (PR https://github.com/stablyai/orca/pull/926).
    draftPromptFlag: '--prefill'
  },
  'claude-agent-teams': {
    // Why: Orca-provided launch mode, not a separate binary; detect via the Orca CLI.
    detectCmd: 'orca',
    detectCmdAliases: ['orca-dev', 'orca-ide'],
    // Why: require Claude too so fresh installs don't report Agent Teams without an agent CLI.
    detectRequiredCommands: ['claude'],
    // Why: Windows/WSL use Claude's in-process Agent Teams fallback, not this native-pane wrapper.
    detectUnsupportedRuntimes: ['win32', 'wsl'],
    launchCmd: 'orca claude-teams',
    launchCmdByPlatform: {
      linux: `${getOrcaCliCommandNameForPlatform('linux')} claude-teams`,
      win32: `${getOrcaCliCommandNameForPlatform('win32')} claude-teams`
    },
    expectedProcess: 'claude',
    promptInjectionMode: 'stdin-after-start'
  },
  openclaude: {
    detectCmd: 'openclaude',
    launchCmd: 'openclaude',
    expectedProcess: 'openclaude',
    promptInjectionMode: 'argv',
    draftPromptFlag: '--prefill'
  },
  codex: {
    detectCmd: 'codex',
    launchCmd: 'codex',
    expectedProcess: 'codex',
    promptInjectionMode: 'argv',
    windowsInputRecordPasteNewline: 'alt-enter',
    preflightTrust: 'codex',
    draftPasteReadySignal: 'codex-composer-prompt',
    draftPasteReadyTimeoutMs: 20_000
  },
  autohand: {
    detectCmd: 'autohand',
    launchCmd: 'autohand',
    expectedProcess: 'autohand',
    promptInjectionMode: 'stdin-after-start'
  },
  ante: {
    detectCmd: 'ante',
    launchCmd: 'ante',
    expectedProcess: 'ante',
    // Why: `ante --prompt` is headless (runs once and exits), so launch the bare TUI and inject after startup.
    promptInjectionMode: 'stdin-after-start'
  },
  trae: {
    // Why: bytedance/trae-agent also installs `trae-cli`; detect TRAE CN's `traecli` alias instead.
    detectCmd: 'traecli',
    launchCmd: 'traecli',
    expectedProcess: 'traecli',
    // Why: `traecli [prompt]` takes the task as a positional argv, same as Claude/Codex.
    promptInjectionMode: 'argv',
    // Why: `--` stops Cobra parsing so `help`/`config`/`-…` prompts aren't treated as subcommands/flags.
    argvPromptSeparator: '--'
  },
  opencode: {
    detectCmd: 'opencode',
    launchCmd: 'opencode',
    expectedProcess: 'opencode',
    promptInjectionMode: 'flag-prompt',
    // Why: opencode enables bracketed paste before its composer mounts; wait for the show-cursor signal.
    draftPasteReadySignal: 'render-cursor-after-bracketed-paste'
  },
  'mimo-code': {
    detectCmd: 'mimo',
    launchCmd: 'mimo',
    expectedProcess: 'mimo',
    promptInjectionMode: 'flag-prompt',
    // Why: mirrors opencode's cursor-gated signal by parity; mimo's startup stream isn't separately validated.
    draftPasteReadySignal: 'render-cursor-after-bracketed-paste'
  },
  pi: {
    detectCmd: 'pi',
    launchCmd: 'pi',
    expectedProcess: 'pi',
    promptInjectionMode: 'argv',
    // Why: pi has no `--prefill`; the orca-prefill extension seeds this env var instead.
    draftPromptEnvVar: 'ORCA_PI_PREFILL',
    // Why: Pi decodes CSI-u; Esc+CR submits after tool subprocesses reset live KKP state (#9703).
    windowsShiftEnterEncoding: 'csi-u'
  },
  omp: {
    detectCmd: 'omp',
    launchCmd: 'omp',
    expectedProcess: 'omp',
    promptInjectionMode: 'argv',
    draftPromptEnvVar: 'ORCA_OMP_PREFILL'
  },
  'prime-agent': {
    detectCmd: 'prime-agent',
    launchCmd: 'prime-agent',
    expectedProcess: 'prime-agent',
    promptInjectionMode: 'argv',
    // Why: `--` stops subcommand parsing so `help`/`agents`/`-…` prompts aren't treated as flags.
    argvPromptSeparator: '--',
    // Why: embeds Pi's TUI and decodes CSI-u the same way (see pi above).
    windowsShiftEnterEncoding: 'csi-u'
  },
  gemini: {
    detectCmd: 'gemini',
    launchCmd: 'gemini',
    expectedProcess: 'gemini',
    promptInjectionMode: 'flag-prompt-interactive'
  },
  antigravity: {
    detectCmd: 'agy',
    launchCmd: 'agy',
    expectedProcess: 'agy',
    promptInjectionMode: 'flag-prompt-interactive'
  },
  aider: {
    detectCmd: 'aider',
    launchCmd: 'aider',
    expectedProcess: 'aider',
    promptInjectionMode: 'stdin-after-start'
  },
  goose: {
    detectCmd: 'goose',
    launchCmd: 'goose',
    expectedProcess: 'goose',
    promptInjectionMode: 'stdin-after-start'
  },
  amp: {
    detectCmd: 'amp',
    launchCmd: 'amp',
    expectedProcess: 'amp',
    promptInjectionMode: 'stdin-after-start'
  },
  kilo: {
    detectCmd: 'kilo',
    launchCmd: 'kilo',
    expectedProcess: 'kilo',
    promptInjectionMode: 'stdin-after-start'
  },
  kiro: {
    // Why: installer ships `kiro-cli`, not `kiro`; keep id 'kiro' for stored prefs.
    detectCmd: 'kiro-cli',
    // Why: trust flags like --trust-all-tools attach to Kiro's `chat` subcommand.
    launchCmd: 'kiro-cli chat --tui',
    expectedProcess: 'kiro-cli',
    promptInjectionMode: 'stdin-after-start'
  },
  crush: {
    detectCmd: 'crush',
    launchCmd: 'crush',
    expectedProcess: 'crush',
    promptInjectionMode: 'stdin-after-start'
  },
  aug: {
    // Why: @augmentcode/auggie installs `auggie`, not `aug`; keep id 'aug' for stored prefs.
    detectCmd: 'auggie',
    launchCmd: 'auggie',
    expectedProcess: 'auggie',
    promptInjectionMode: 'stdin-after-start'
  },
  cline: {
    detectCmd: 'cline',
    launchCmd: 'cline',
    expectedProcess: 'cline',
    promptInjectionMode: 'stdin-after-start'
  },
  codebuff: {
    detectCmd: 'codebuff',
    launchCmd: 'codebuff',
    expectedProcess: 'codebuff',
    promptInjectionMode: 'stdin-after-start'
  },
  'command-code': {
    // Why: use the full name (not `cmd` alias) so detection doesn't collide with Windows' built-in cmd.exe.
    detectCmd: 'command-code',
    // Why: `--trust` skips the first-run trust prompt so it doesn't consume the task text.
    launchCmd: 'command-code --trust',
    expectedProcess: 'command-code',
    promptInjectionMode: 'argv'
  },
  continue: {
    // Why: Continue's CLI binary is `cn`; `continue` is a bash/zsh builtin.
    detectCmd: 'cn',
    launchCmd: 'cn',
    expectedProcess: 'cn',
    promptInjectionMode: 'stdin-after-start'
  },
  cursor: {
    detectCmd: 'cursor-agent',
    launchCmd: 'cursor-agent',
    expectedProcess: 'cursor-agent',
    promptInjectionMode: 'argv',
    // Why: pre-write the .workspace-trusted marker so first-launch trust menu doesn't consume the paste.
    preflightTrust: 'cursor'
  },
  droid: {
    detectCmd: 'droid',
    launchCmd: 'droid',
    expectedProcess: 'droid',
    promptInjectionMode: 'argv',
    // Why: Droid decodes CSI-u on Windows; legacy Esc+CR reads as Enter and submits instead of newline.
    windowsShiftEnterEncoding: 'csi-u',
    ctrlEnterEncoding: 'csi-u'
  },
  kimi: {
    detectCmd: 'kimi',
    launchCmd: 'kimi',
    expectedProcess: 'kimi',
    promptInjectionMode: 'stdin-after-start'
  },
  'mistral-vibe': {
    // Why: installer exposes binary `vibe` though the package is mistral-vibe; keep old name as alias.
    detectCmd: 'vibe',
    detectCmdAliases: ['mistral-vibe'],
    launchCmd: 'vibe',
    expectedProcess: 'vibe',
    promptInjectionMode: 'stdin-after-start'
  },
  'qwen-code': {
    // Why: package is qwen-code but its installed CLI binary on PATH is `qwen`.
    detectCmd: 'qwen',
    launchCmd: 'qwen',
    expectedProcess: 'qwen',
    promptInjectionMode: 'stdin-after-start'
  },
  rovo: {
    detectCmd: 'rovo',
    launchCmd: 'rovo',
    expectedProcess: 'rovo',
    promptInjectionMode: 'stdin-after-start'
  },
  hermes: {
    detectCmd: 'hermes',
    // Why: bare `hermes` opens the classic REPL; `--tui` starts the full-screen agent UI.
    launchCmd: 'hermes --tui',
    expectedProcess: 'hermes',
    // Why: Hermes delivers the prompt via its startup-query contract.
    promptInjectionMode: 'hermes-query'
  },
  openclaw: {
    detectCmd: 'openclaw',
    launchCmd: 'openclaw',
    expectedProcess: 'openclaw',
    promptInjectionMode: 'stdin-after-start'
  },
  copilot: {
    detectCmd: 'copilot',
    launchCmd: 'copilot',
    expectedProcess: 'copilot',
    // Why: `--prompt` exits on completion; `-i/--interactive` keeps the session alive.
    promptInjectionMode: 'flag-interactive',
    // Why: pre-write trust so first-launch trust menu doesn't consume the paste (see agent-trust-presets.ts).
    preflightTrust: 'copilot'
  },
  grok: {
    detectCmd: 'grok',
    launchCmd: 'grok',
    expectedProcess: 'grok',
    promptInjectionMode: 'argv',
    // Why: separator so prompts like `help`/`--version` aren't parsed as Grok CLI syntax.
    argvPromptSeparator: '--',
    // Why: grok shimmers its startup logo; the composer glyph lands ~0.6s in.
    draftPasteReadySignal: 'grok-composer-prompt',
    ctrlEnterEncoding: 'csi-u'
  },
  devin: {
    detectCmd: 'devin',
    launchCmd: 'devin',
    expectedProcess: 'devin',
    // Why: `devin -- <prompt>` auto-submits; start the REPL with no argv prompt instead.
    promptInjectionMode: 'stdin-after-start'
  },
  herdr: {
    detectCmd: 'herdr',
    launchCmd: 'herdr',
    expectedProcess: 'herdr',
    promptInjectionMode: 'stdin-after-start'
  }
}

export function isTuiAgent(value: unknown): value is TuiAgent {
  return typeof value === 'string' && Object.hasOwn(TUI_AGENT_CONFIG, value)
}

export function getTuiAgentDetectCommands(config: TuiAgentConfig): string[] {
  return [config.detectCmd, ...(config.detectCmdAliases ?? [])]
}

export function getTuiAgentLaunchCommand(
  config: TuiAgentConfig,
  platform: NodeJS.Platform,
  opts?: { isRemote?: boolean }
): string {
  // Why: local-only orca-ide rename (avoids GNOME Orca clash) must not leak to Linux remotes, whose relay shim is always `orca`.
  if (opts?.isRemote && platform === 'linux') {
    return config.launchCmd
  }
  return config.launchCmdByPlatform?.[platform] ?? config.launchCmd
}
