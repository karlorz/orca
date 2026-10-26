import { describe, expect, it } from 'vitest'
import {
  getAgentSessionOptionCatalog,
  mergeCatalogModels,
  mergeDiscoveredAuthoritativeModels,
  type CatalogModel,
  type CatalogOption
} from './agent-session-option-catalog'
import { GROK_SESSION_OPTION_CATALOG } from './agent-session-option-catalog-grok'
import { resolveAgentSessionOptionLaunch } from './agent-session-option-launch'
import { parseBuiltSessionOptionCommand } from './native-chat-session-option-commands'

function grokEffortOption(modelId = 'grok-4.7'): CatalogOption {
  const model = GROK_SESSION_OPTION_CATALOG.models.find((candidate) => candidate.id === modelId)!
  return model.options.find((option) => option.id === 'effort')!
}

function effortValues(option: CatalogOption): string[] {
  return option.kind.type === 'select' ? option.kind.choices.map((choice) => choice.value) : []
}

/** What `grok -m <id> --reasoning-effort bogus` reports as that model's valid set. */
const PROBED_EFFORT_MENUS: Record<string, string[]> = {
  'grok-4.7': ['low', 'medium', 'high', 'xhigh'],
  'grok-4.6': ['low', 'medium', 'high', 'xhigh'],
  'grok-4.5': ['low', 'medium', 'high'],
  'grok-4.7-build-fast': ['low', 'medium', 'high', 'xhigh'],
  'kimi-k3': ['high', 'max'],
  'flash-max': ['high', 'max'],
  'gpt-6.1-sol': ['medium', 'high', 'xhigh', 'max'],
  'gpt-5.6-sol': ['medium', 'high', 'xhigh', 'max'],
  'gpt-5.6-luna': ['medium', 'high', 'xhigh', 'max'],
  'deepseek-v4-flash': ['high', 'max'],
  'grok-auto': ['high', 'max'],
  sonnet: ['max'],
  haiku: ['max'],
  'flash-non-reasoning': []
}

describe('grok session option catalog', () => {
  it('is registered for the grok agent', () => {
    expect(getAgentSessionOptionCatalog('grok')).toBe(GROK_SESSION_OPTION_CATALOG)
  })

  it('seeds every model the installed CLI lists, defaulting to the newest', () => {
    expect(
      GROK_SESSION_OPTION_CATALOG.models.map(({ id, label, isDefault }) => ({
        id,
        label,
        isDefault
      }))
    ).toEqual([
      { id: 'grok-4.7', label: 'Grok 4.7', isDefault: true },
      { id: 'grok-4.6', label: 'Grok 4.6', isDefault: undefined },
      { id: 'grok-4.5', label: 'Grok 4.5', isDefault: undefined },
      { id: 'grok-4.7-build-fast', label: 'Grok 4.7 Build Fast', isDefault: undefined },
      { id: 'kimi-k3', label: 'Kimi K3', isDefault: undefined },
      { id: 'flash-max', label: 'Flash Max', isDefault: undefined },
      { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol', isDefault: undefined },
      { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', isDefault: undefined },
      { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna', isDefault: undefined },
      { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash', isDefault: undefined },
      { id: 'grok-auto', label: 'Grok Auto', isDefault: undefined },
      { id: 'sonnet', label: 'Sonnet', isDefault: undefined },
      { id: 'haiku', label: 'Haiku', isDefault: undefined },
      { id: 'flash-non-reasoning', label: 'Flash Non-Reasoning', isDefault: undefined }
    ])
    expect(Object.keys(PROBED_EFFORT_MENUS)).toEqual(
      GROK_SESSION_OPTION_CATALOG.models.map(({ id }) => id)
    )
  })

  it('keeps the effort option shaped the way the picker and the wire expect', () => {
    const effort = grokEffortOption()
    // Keep effort: LaunchPreferences strips/rejects unknown keys at client/wire boundaries.
    expect(effort.id).toBe('effort')
    expect(effort.category).toBe('thought_level')
    // Why: the agent default is the absence of the flag, so the catalog names no value.
    expect(effort.kind).toMatchObject({ type: 'select' })
    expect(effort.kind).not.toHaveProperty('defaultValue')
  })

  it('offers each seeded model exactly the tiers the current grok CLI accepts', () => {
    // grok exits on an unknown tier (`use one of: ...`), so the menu is exact per model.
    for (const [model, values] of Object.entries(PROBED_EFFORT_MENUS)) {
      const option = GROK_SESSION_OPTION_CATALOG.models
        .find((candidate) => candidate.id === model)!
        .options.find((candidate) => candidate.id === 'effort')
      expect(option ? effortValues(option) : []).toEqual(values)
    }
  })

  it('offers no effort menu on the model that ignores the flag', () => {
    // flash-non-reasoning never validates --reasoning-effort, so a menu would be fiction.
    const model = GROK_SESSION_OPTION_CATALOG.models.find(
      (candidate) => candidate.id === 'flash-non-reasoning'
    )
    expect(model?.options).toEqual([])
  })

  it('offers only effort values the shared option labels localize', () => {
    const localized = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']
    for (const model of GROK_SESSION_OPTION_CATALOG.models) {
      const option = model.options.find((candidate) => candidate.id === 'effort')
      for (const value of option ? effortValues(option) : []) {
        expect(localized).toContain(value)
      }
    }
  })

  it('gives unknown model ids the widest menu launch reads from the seed', () => {
    const unknown = GROK_SESSION_OPTION_CATALOG.unknownModelOptions ?? []
    expect(unknown.map(({ id }) => id)).toEqual(['effort'])
    // Agent default omits the flag, so the widest menu risks nothing but an explicit pick.
    expect(effortValues(unknown[0])).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
    expect(unknown[0].kind).not.toHaveProperty('defaultValue')
  })

  it('treats a successful discovery as authoritative, unlike the other agents', () => {
    expect(GROK_SESSION_OPTION_CATALOG.discoveredModelsAreAuthoritative).toBe(true)
    for (const agent of ['claude', 'codex', 'gemini', 'cursor'] as const) {
      expect(getAgentSessionOptionCatalog(agent)?.discoveredModelsAreAuthoritative).toBeUndefined()
    }
  })
})

describe('grok launch args', () => {
  it('emits the model flag first, then the picked effort', () => {
    expect(resolveAgentSessionOptionLaunch('grok', { model: 'grok-4.5', effort: 'high' })).toEqual({
      args: ['-m', 'grok-4.5', '--reasoning-effort', 'high'],
      appliedValues: { model: 'grok-4.5', effort: 'high' }
    })
  })

  it('carries the xhigh tier through to argv on a model that accepts it', () => {
    expect(resolveAgentSessionOptionLaunch('grok', { model: 'grok-4.6', effort: 'xhigh' })).toEqual(
      {
        args: ['-m', 'grok-4.6', '--reasoning-effort', 'xhigh'],
        appliedValues: { model: 'grok-4.6', effort: 'xhigh' }
      }
    )
  })

  it('drops a tier the picked model does not accept', () => {
    // grok-4.5 tops out at high and grok-4.6 has no max, so neither may reach argv.
    for (const [model, effort] of [
      ['grok-4.5', 'xhigh'],
      ['grok-4.5', 'max'],
      ['grok-4.6', 'max'],
      ['kimi-k3', 'high_extra'],
      ['sonnet', 'high']
    ]) {
      expect(resolveAgentSessionOptionLaunch('grok', { model, effort })).toEqual({
        args: ['-m', model],
        appliedValues: { model }
      })
    }
  })

  it('emits exactly the two model tokens', () => {
    expect(GROK_SESSION_OPTION_CATALOG.modelApply.launchArgs!('grok-4.6')).toEqual([
      '-m',
      'grok-4.6'
    ])
  })

  it('omits every effort flag when only a model is picked', () => {
    // No catalog default: "agent default" means grok picks its own tier.
    for (const model of ['grok-4.7', 'grok-4.6', 'grok-4.5']) {
      expect(resolveAgentSessionOptionLaunch('grok', { model })).toEqual({
        args: ['-m', model],
        appliedValues: { model }
      })
    }
  })

  it.each(['low', 'medium', 'high'])('carries %s through on grok-4.5', (effort) => {
    expect(resolveAgentSessionOptionLaunch('grok', { model: 'grok-4.5', effort })).toEqual({
      args: ['-m', 'grok-4.5', '--reasoning-effort', effort],
      appliedValues: { model: 'grok-4.5', effort }
    })
  })

  it('emits -m only for a persisted model the seed does not carry', () => {
    // The model flag still goes out for a model this host may no longer have, and grok
    // exits fatally on an unknown id. Launch resolves against the static seed, so
    // the guard lives upstream: an authoritative probe retires the persisted id
    // (clearNativeChatSessionModel) before it can reach this call.
    expect(resolveAgentSessionOptionLaunch('grok', { model: 'grok-build' })).toEqual({
      args: ['-m', 'grok-build'],
      appliedValues: { model: 'grok-build' }
    })
  })

  it('carries a picked effort onto a discovered model the seed never listed', () => {
    // Regression: launch reads options off the static seed, so a discovered id
    // resolved to no options and dropped `--reasoning-effort` from the argv.
    expect(
      resolveAgentSessionOptionLaunch('grok', { model: 'grok-build', effort: 'high' })
    ).toEqual({
      args: ['-m', 'grok-build', '--reasoning-effort', 'high'],
      appliedValues: { model: 'grok-build', effort: 'high' }
    })
  })

  it.each(['low', 'medium', 'xhigh', 'max'])(
    'carries %s onto an unseeded model, whose menu is the widest one',
    (effort) => {
      expect(resolveAgentSessionOptionLaunch('grok', { model: 'grok-build', effort })).toEqual({
        args: ['-m', 'grok-build', '--reasoning-effort', effort],
        appliedValues: { model: 'grok-build', effort }
      })
    }
  )

  it('drops an effort value the menu does not offer on an unseeded model', () => {
    expect(
      resolveAgentSessionOptionLaunch('grok', { model: 'grok-build', effort: 'none' })
    ).toEqual({ args: ['-m', 'grok-build'], appliedValues: { model: 'grok-build' } })
  })

  it('honors a user effort flag over the picker on an unseeded model too', () => {
    expect(
      resolveAgentSessionOptionLaunch('grok', { model: 'grok-build', effort: 'high' }, [
        '--reasoning-effort=max'
      ]).appliedValues
    ).toEqual({ model: 'grok-build' })
  })

  it('adds no effort flag for a model the seed does not carry', () => {
    expect(resolveAgentSessionOptionLaunch('grok', { model: 'grok-build' }).args).toEqual([
      '-m',
      'grok-build'
    ])
  })

  it('adds no effort flag for a discovered gpt-6.1-sol launch', () => {
    expect(resolveAgentSessionOptionLaunch('grok', { model: 'gpt-6.1-sol' })).toEqual({
      args: ['-m', 'gpt-6.1-sol'],
      appliedValues: { model: 'gpt-6.1-sol' }
    })
  })

  it('spawns vanilla when no model was ever picked, even with an effort picked', () => {
    expect(resolveAgentSessionOptionLaunch('grok', undefined)).toEqual({
      args: [],
      appliedValues: {}
    })
    // Session-option launch preferences require a selected model.
    expect(resolveAgentSessionOptionLaunch('grok', { effort: 'max' })).toEqual({
      args: [],
      appliedValues: {}
    })
  })
})

describe('grok agent-arg overrides', () => {
  const removeModel = GROK_SESSION_OPTION_CATALOG.modelApply.removeAgentArgs!
  const removeEffort = grokEffortOption().apply.removeAgentArgs!

  it('strips a user-supplied model flag in every spelling', () => {
    for (const tokens of [
      ['-m', 'grok-build'],
      ['-mgrok-build'],
      ['--model', 'grok-build'],
      ['--model=grok-build']
    ]) {
      expect(removeModel(tokens)).toEqual([])
    }
  })

  it('does not fire on a different flag or a positional that contains -m', () => {
    for (const tokens of [
      ['--model-context', '8000'],
      ['summarize-my-diff'],
      ['--reasoning-effort', 'low'],
      []
    ]) {
      expect(removeModel(tokens)).toEqual(tokens)
    }
  })

  it('strips both effort spellings', () => {
    expect(removeEffort(['--effort', 'low', '--reasoning-effort=high', '--keep'])).toEqual([
      '--keep'
    ])
    expect(removeEffort(['--effortless'])).toEqual(['--effortless'])
  })

  it('drops only the overridden key from the launch record and argv', () => {
    expect(
      resolveAgentSessionOptionLaunch('grok', { model: 'grok-4.5', effort: 'high' }, [
        '--reasoning-effort=low'
      ])
    ).toEqual({
      args: ['-m', 'grok-4.5'],
      appliedValues: { model: 'grok-4.5' }
    })
  })

  it('cascades a model override onto the effort entry', () => {
    // User -m overrides can change the effort menu, invalidating the picker's evidence.
    expect(
      resolveAgentSessionOptionLaunch('grok', { model: 'grok-4.5', effort: 'high' }, [
        '-m',
        'grok-build'
      ]).appliedValues
    ).toEqual({})
  })

  it('keeps the record intact when a lookalike flag is present', () => {
    expect(
      resolveAgentSessionOptionLaunch('grok', { model: 'grok-4.5', effort: 'high' }, [
        '--model-context',
        '8000'
      ]).appliedValues
    ).toEqual({ model: 'grok-4.5', effort: 'high' })
  })
})

describe('grok mid-session commands', () => {
  it('round-trips the model command through the built-command parser', () => {
    const midSession = GROK_SESSION_OPTION_CATALOG.modelApply.midSession!
    if (midSession.kind !== 'command') {
      throw new Error('grok model changes must be a typed command, not an agent picker')
    }
    expect(midSession.build('grok-4.5')).toBe('/model grok-4.5')
    expect(parseBuiltSessionOptionCommand(midSession.build, '/model grok-4.5')).toBe('grok-4.5')
    expect(parseBuiltSessionOptionCommand(midSession.build, '/effort low')).toBeNull()
  })

  it('round-trips the effort command', () => {
    const midSession = grokEffortOption().apply.midSession!
    if (midSession.kind !== 'command') {
      throw new Error('grok effort changes must be a typed command')
    }
    expect(midSession.build('high')).toBe('/effort high')
    expect(parseBuiltSessionOptionCommand(midSession.build, '/effort high')).toBe('high')
    expect(parseBuiltSessionOptionCommand(midSession.build, '/effort ')).toBeNull()
  })
})

describe('mergeDiscoveredAuthoritativeModels', () => {
  const seed = GROK_SESSION_OPTION_CATALOG.models
  const discovered = (...ids: string[]): CatalogModel[] =>
    ids.map((id) => ({ id, label: id, options: [] }))
  const mergedEffortValues = (model: CatalogModel): string[] => {
    const effort = model.options.find((option) => option.id === 'effort')
    return effort?.kind.type === 'select' ? effort.kind.choices.map((choice) => choice.value) : []
  }

  it('keeps a matched seed model’s option menu, which discovery never carries', () => {
    const merged = mergeDiscoveredAuthoritativeModels(seed, [
      { id: 'grok-4.5', label: 'Grok 4.5 (live)', options: [] }
    ])
    expect(merged).toHaveLength(1)
    expect(merged[0]).toMatchObject({ id: 'grok-4.5', label: 'Grok 4.5 (live)' })
    // Its own menu, not the default row's — 4.5 has no xhigh tier.
    expect(mergedEffortValues(merged[0])).toEqual(['low', 'medium', 'high'])
  })

  it('takes the default flag from the probe and drops the seed’s stale one', () => {
    // The seed marks grok-4.5; once the account's listing marks another row, the
    // picker must follow it or it names a model an unflagged launch will not run.
    const merged = mergeDiscoveredAuthoritativeModels(seed, [
      { id: 'grok-4.5', label: 'Grok 4.5', options: [] },
      { id: 'grok-5', label: 'Grok 5', isDefault: true, options: [] }
    ])
    expect(merged.map(({ id, isDefault }) => [id, isDefault])).toEqual([
      ['grok-4.5', undefined],
      ['grok-5', true]
    ])
  })

  it('names no default when the probe marks none, rather than reviving the seed’s', () => {
    const merged = mergeDiscoveredAuthoritativeModels(seed, discovered('grok-4.5'))
    expect(merged[0].isDefault).toBeUndefined()
    // The seed's menu still survives — only the default claim is discovery's to make.
    expect(merged[0].options.map(({ id }) => id)).toEqual(['effort'])
  })

  it('gives a matched seed row its own menu, not the default row’s', () => {
    const multiSeed: CatalogModel[] = [
      { id: 'grok-4.6', label: 'Grok 4.6', isDefault: true, options: seed[0].options },
      { id: 'grok-lite', label: 'Grok Lite', options: [] }
    ]
    const merged = mergeDiscoveredAuthoritativeModels(multiSeed, discovered('grok-lite'))
    expect(merged.map(({ id }) => id)).toEqual(['grok-lite'])
    expect(merged[0].options).toEqual([])
  })

  it('drops a seed model the account no longer lists', () => {
    const merged = mergeDiscoveredAuthoritativeModels(seed, discovered('grok-build'))
    expect(merged.map(({ id }) => id)).toEqual(['grok-build'])
  })

  it('adds discovered models absent from the seed, lending them the default’s options', () => {
    // An unseeded model gets the default row's menu instead of an option-less pill,
    // while a seeded sibling keeps the menu its own grok listing advertises.
    const merged = mergeDiscoveredAuthoritativeModels(seed, discovered('grok-4.5', 'grok-build'))
    expect(merged.map(({ id }) => id)).toEqual(['grok-4.5', 'grok-build'])
    expect(mergedEffortValues(merged[0])).toEqual(['low', 'medium', 'high'])
    expect(mergedEffortValues(merged[1])).toEqual(['low', 'medium', 'high', 'xhigh'])
  })

  it('takes the inherited options from the default seed row, not the first one', () => {
    const multiSeed: CatalogModel[] = [
      { id: 'legacy', label: 'Legacy', options: [] },
      { id: 'grok-4.6', label: 'Grok 4.6', isDefault: true, options: seed[0].options }
    ]
    const merged = mergeDiscoveredAuthoritativeModels(multiSeed, discovered('grok-build'))
    expect(merged[0].options.map(({ id }) => id)).toEqual(['effort'])
  })

  it('lends no options when the seed is empty', () => {
    expect(mergeDiscoveredAuthoritativeModels([], discovered('grok-build'))).toEqual([
      { id: 'grok-build', label: 'grok-build', options: [] }
    ])
  })

  it('preserves discovery order rather than seed order', () => {
    const merged = mergeDiscoveredAuthoritativeModels(seed, discovered('grok-build', 'grok-4.5'))
    expect(merged.map(({ id }) => id)).toEqual(['grok-build', 'grok-4.5'])
  })

  it('publishes an empty list for an empty discovery, so callers must gate on it', () => {
    // Only enrichment's non-empty guard keeps a failed probe from blanking the picker.
    expect(mergeDiscoveredAuthoritativeModels(seed, [])).toEqual([])
  })

  it('drops the unmatched seed row the additive merge would have kept', () => {
    expect(mergeCatalogModels(seed, discovered('grok-build')).map(({ id }) => id)).toEqual([
      ...seed.map(({ id }) => id),
      'grok-build'
    ])
    expect(
      mergeDiscoveredAuthoritativeModels(seed, discovered('grok-build')).map(({ id }) => id)
    ).toEqual(['grok-build'])
  })
})
