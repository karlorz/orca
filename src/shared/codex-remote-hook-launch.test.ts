import { describe, expect, it } from 'vitest'
import { buildAgentResumeStartupPlan, buildAgentStartupPlan } from './tui-agent-startup'

const HOOK_ARGS = '$ORCA_CODEX_HOOK_ENABLE_ARG $ORCA_CODEX_HOOK_FEATURE_ARG'
const DEFAULT_HOOK_ENV = {
  ORCA_CODEX_HOOK_ENABLE_ARG: '-c',
  ORCA_CODEX_HOOK_FEATURE_ARG: 'features.hooks=false'
}

describe('remote Codex hook launch context', () => {
  it('guards submitted and paste-ready remote POSIX Codex launches with the PTY coordinates', () => {
    const args = {
      agent: 'codex' as const,
      cmdOverrides: {},
      agentArgs: '--dangerously-bypass-approvals-and-sandbox',
      platform: 'linux' as const,
      shell: 'posix' as const,
      isRemote: true
    }
    const startup = buildAgentStartupPlan({ ...args, prompt: 'fix it' })
    const pasteReady = buildAgentStartupPlan({
      ...args,
      prompt: '',
      allowEmptyPromptLaunch: true
    })

    expect(startup?.launchCommand).toBe(
      `codex ${HOOK_ARGS} '--dangerously-bypass-approvals-and-sandbox' 'fix it'`
    )
    expect(startup?.launchConfig.agentCommand).toBe(
      `codex ${HOOK_ARGS} '--dangerously-bypass-approvals-and-sandbox'`
    )
    expect(startup?.launchConfig.agentEnv).toEqual(DEFAULT_HOOK_ENV)
    expect(pasteReady?.launchCommand).toBe(
      `codex ${HOOK_ARGS} '--dangerously-bypass-approvals-and-sandbox'`
    )
    expect(startup?.env).toEqual(DEFAULT_HOOK_ENV)
    expect(pasteReady?.env).toEqual(DEFAULT_HOOK_ENV)
  })

  it('upgrades a captured remote POSIX Codex command exactly once on resume', () => {
    const resume = (agentCommand: string) =>
      buildAgentResumeStartupPlan({
        agent: 'codex',
        providerSession: { key: 'session_id', id: 's1' },
        cmdOverrides: {},
        agentCommand,
        platform: 'linux',
        shell: 'posix',
        isRemote: true
      })

    expect(resume('codex --profile captured')?.launchCommand).toBe(
      `codex --profile captured ${HOOK_ARGS} 'resume' 's1'`
    )
    expect(resume(`codex ${HOOK_ARGS}`)?.launchCommand).toBe(`codex ${HOOK_ARGS} 'resume' 's1'`)
  })

  it.each([
    [`codex -- ${HOOK_ARGS}`, `codex ${HOOK_ARGS} -- ${HOOK_ARGS} 'resume' 's1'`],
    [`codex '${HOOK_ARGS}'`, `codex '${HOOK_ARGS}' ${HOOK_ARGS} 'resume' 's1'`],
    [`codex # ${HOOK_ARGS}`, `codex ${HOOK_ARGS} # ${HOOK_ARGS} 'resume' 's1'`]
  ])(
    'does not mistake inactive hook placeholder text for planned argv: %s',
    (command, expected) => {
      const plan = buildAgentResumeStartupPlan({
        agent: 'codex',
        providerSession: { key: 'session_id', id: 's1' },
        cmdOverrides: {},
        agentCommand: command,
        platform: 'linux',
        shell: 'posix',
        isRemote: true
      })

      expect(plan?.launchCommand).toBe(expected)
      expect(plan?.env).toEqual(DEFAULT_HOOK_ENV)
    }
  )

  it.each([
    '--disable hooks',
    '--disable=hooks',
    '-c features.hooks=false',
    '-c=features.hooks=false',
    '-cfeatures.hooks=false',
    "--config 'features.hooks = false'"
  ])('preserves an explicit hooks override in agent args: %s', (agentArgs) => {
    const plan = buildAgentStartupPlan({
      agent: 'codex',
      prompt: 'fix it',
      cmdOverrides: {},
      agentArgs,
      platform: 'linux',
      shell: 'posix',
      isRemote: true
    })

    expect(plan?.launchCommand).not.toContain(HOOK_ARGS)
    expect(plan?.env).toBeUndefined()
  })

  it('preserves an explicit hooks override in the command override', () => {
    const plan = buildAgentStartupPlan({
      agent: 'codex',
      prompt: 'fix it',
      cmdOverrides: { codex: 'codex --config=features.hooks=false' },
      platform: 'linux',
      shell: 'posix',
      isRemote: true
    })

    expect(plan?.launchCommand).toBe("codex --config=features.hooks=false 'fix it'")
  })

  it('does not treat hook-like prompt tokens after the option terminator as an override', () => {
    const plan = buildAgentStartupPlan({
      agent: 'codex',
      prompt: 'fix it',
      cmdOverrides: {},
      agentArgs: '-- --disable hooks',
      platform: 'linux',
      shell: 'posix',
      isRemote: true
    })

    expect(plan?.launchCommand).toContain(HOOK_ARGS)
  })

  it('finds a launch override after a wrapper terminator', () => {
    const plan = buildAgentStartupPlan({
      agent: 'codex',
      prompt: 'fix it',
      cmdOverrides: { codex: 'mise exec -- codex --config features.hooks=false' },
      platform: 'linux',
      shell: 'posix',
      isRemote: true
    })

    expect(plan?.launchCommand).toBe("mise exec -- codex --config features.hooks=false 'fix it'")
    expect(plan?.env).toBeUndefined()
  })

  it.each([
    ['codex --', `codex ${HOOK_ARGS} -- 'fix it'`],
    ['codex # note', `codex ${HOOK_ARGS} # note 'fix it'`],
    ['mise exec -- codex', `mise exec -- codex ${HOOK_ARGS} 'fix it'`]
  ])('inserts hook argv before Codex shell syntax: %s', (override, expected) => {
    const plan = buildAgentStartupPlan({
      agent: 'codex',
      prompt: 'fix it',
      cmdOverrides: { codex: override },
      platform: 'linux',
      shell: 'posix',
      isRemote: true
    })

    expect(plan?.launchCommand).toBe(expected)
  })

  it('fails open for an override whose prefix cannot be parsed as argv', () => {
    const plan = buildAgentStartupPlan({
      agent: 'codex',
      prompt: 'fix it',
      cmdOverrides: { codex: 'select-profile && codex' },
      platform: 'linux',
      shell: 'posix',
      isRemote: true
    })

    expect(plan?.launchCommand).toBe("select-profile && codex 'fix it'")
    expect(plan?.env).toBeUndefined()
  })

  it.each(['sh -c \'codex "$@"\' --', 'npx @openai/codex'])(
    'fails open for an opaque Codex wrapper: %s',
    (override) => {
      const plan = buildAgentStartupPlan({
        agent: 'codex',
        prompt: 'fix it',
        cmdOverrides: { codex: override },
        platform: 'linux',
        shell: 'posix',
        isRemote: true
      })

      expect(plan?.launchCommand).toBe(`${override} 'fix it'`)
      expect(plan?.env).toBeUndefined()
    }
  )

  it.each([
    { agent: 'claude' as const, platform: 'linux' as const, isRemote: true },
    { agent: 'codex' as const, platform: 'linux' as const, isRemote: false },
    { agent: 'codex' as const, platform: 'win32' as const, isRemote: true }
  ])('leaves non-target launch context unchanged: $agent/$platform/$isRemote', (context) => {
    const plan = buildAgentStartupPlan({
      ...context,
      prompt: 'fix it',
      cmdOverrides: {},
      shell: context.platform === 'win32' ? 'powershell' : 'posix'
    })

    expect(plan?.launchCommand).not.toContain(HOOK_ARGS)
  })
})
