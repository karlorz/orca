import type {
  AgentSessionOptionCatalog,
  CatalogModel,
  CatalogOption
} from './agent-session-option-catalog-types'
import { removeAgentArgOption } from './agent-session-option-agent-args'
import { parseGrokModelList } from './grok-model-list-probe'
import type { SessionOptionSelectChoice } from './native-chat-session-options'

const LOW = { value: 'low', label: 'Low' }
const MEDIUM = { value: 'medium', label: 'Medium' }
const HIGH = { value: 'high', label: 'High' }
const XHIGH = { value: 'xhigh', label: 'Extra high' }
const MAX = { value: 'max', label: 'Max' }

// Why: grok validates the tier against the picked model's own menu and exits fatally
// on a mismatch (`use one of: ...`), so each model carries exactly the set it accepts.
function grokEffort(values: readonly SessionOptionSelectChoice[]): CatalogOption {
  return {
    // Keep effort: strict LaunchPreferences drops/rejects novel IDs at client/wire boundaries.
    id: 'effort',
    label: 'Reasoning effort',
    category: 'thought_level',
    kind: {
      type: 'select',
      choices: [...values]
    },
    apply: {
      launchArgs: (value) => ['--reasoning-effort', String(value)],
      // Why: grok reads both spellings.
      removeAgentArgs: (tokens) =>
        removeAgentArgOption('grok', tokens, ['--effort', '--reasoning-effort']),
      midSession: { kind: 'command', build: (value) => `/effort ${String(value)}` }
    }
  }
}

// Private enrichment-gate parser; actual probes parse through agent-model-probe-spec.ts.
function parseGrokCatalogModels(stdout: string): CatalogModel[] {
  return parseGrokModelList(stdout).map((model) => ({ ...model, options: [] }))
}

export const GROK_SESSION_OPTION_CATALOG: AgentSessionOptionCatalog = {
  // Account and model config scope access; seed verified models and discover the rest.
  models: [
    {
      id: 'grok-4.7',
      label: 'Grok 4.7',
      description: "xAI's latest frontier model",
      isDefault: true,
      options: [grokEffort([LOW, MEDIUM, HIGH, XHIGH])]
    },
    {
      id: 'grok-4.6',
      label: 'Grok 4.6',
      description: "xAI's previous frontier model",
      options: [grokEffort([LOW, MEDIUM, HIGH, XHIGH])]
    },
    {
      id: 'grok-4.5',
      label: 'Grok 4.5',
      description: 'An earlier xAI frontier model',
      options: [grokEffort([LOW, MEDIUM, HIGH])]
    },
    {
      id: 'grok-4.7-build-fast',
      label: 'Grok 4.7 Build Fast',
      description: 'Faster build variant of Grok 4.7',
      options: [grokEffort([LOW, MEDIUM, HIGH, XHIGH])]
    },
    {
      id: 'kimi-k3',
      label: 'Kimi K3',
      description: 'Moonshot Kimi K3 served through grok',
      options: [grokEffort([HIGH, MAX])]
    },
    {
      id: 'flash-max',
      label: 'Flash Max',
      description: 'Fast xAI model offered only at the top tiers',
      options: [grokEffort([HIGH, MAX])]
    },
    {
      id: 'gpt-6.1-sol',
      label: 'GPT-6.1 Sol',
      description: 'OpenAI GPT-6.1 Sol served through grok',
      options: [grokEffort([MEDIUM, HIGH, XHIGH, MAX])]
    },
    {
      id: 'gpt-5.6-sol',
      label: 'GPT-5.6 Sol',
      description: 'OpenAI GPT-5.6 Sol served through grok',
      options: [grokEffort([MEDIUM, HIGH, XHIGH, MAX])]
    },
    {
      id: 'gpt-5.6-luna',
      label: 'GPT-5.6 Luna',
      description: 'OpenAI GPT-5.6 Luna served through grok',
      options: [grokEffort([MEDIUM, HIGH, XHIGH, MAX])]
    },
    {
      id: 'deepseek-v4-flash',
      label: 'DeepSeek V4 Flash',
      description: 'DeepSeek V4 Flash served through grok',
      options: [grokEffort([HIGH, MAX])]
    },
    {
      id: 'grok-auto',
      label: 'Grok Auto',
      description: 'xAI routing that picks the model per request',
      options: [grokEffort([HIGH, MAX])]
    },
    {
      id: 'sonnet',
      label: 'Sonnet',
      description: 'Anthropic Sonnet served through grok',
      options: [grokEffort([MAX])]
    },
    {
      id: 'haiku',
      label: 'Haiku',
      description: 'Anthropic Haiku served through grok',
      options: [grokEffort([MAX])]
    },
    {
      id: 'flash-non-reasoning',
      label: 'Flash Non-Reasoning',
      description: 'Flash variant that ignores the reasoning-effort flag',
      // Why: this model never validates the flag, so a menu would promise a choice it drops.
      options: []
    }
  ],
  modelApply: {
    launchArgs: (value) => ['-m', String(value)],
    removeAgentArgs: (tokens) => removeAgentArgOption('grok', tokens, ['-m', '--model']),
    // agent-picker replaces the list and never persists a model, preventing -m emission.
    midSession: { kind: 'command', build: (value) => `/model ${String(value)}` }
  },
  // Why: launch resolves against this static seed, so a discovered id still needs a menu
  // here. Omitting the flag (agent default) is the safe path; an explicit pick outside the
  // model's own set fails with a CLI error naming the valid set, so offer the widest one.
  unknownModelOptions: [grokEffort([LOW, MEDIUM, HIGH, XHIGH, MAX])],
  // Why: grok's selectable ids retire between releases, so a stale seed entry
  // must be droppable — picking one is a fatal launch, not a warning.
  discoveredModelsAreAuthoritative: true,
  // Match the CLI's reported Default model and (default) row marker.
  defaultModelIsCliDefault: true,
  listModels: { command: 'grok models', parse: parseGrokCatalogModels }
}
