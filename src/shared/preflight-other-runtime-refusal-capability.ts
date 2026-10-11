// Split out of protocol-version.ts, which lists the capability in RUNTIME_CAPABILITIES.
// Import these names from here: pulling protocol-version into the mobile agent loader
// splits a web-bundle chunk.

// Why: an older host answers its own agents for a workspace another runtime owns; one with this
// refuses with WORKSPACE_ON_OTHER_RUNTIME, so a client may let it decide for a shared repo id.
export const PREFLIGHT_OTHER_RUNTIME_REFUSAL_RUNTIME_CAPABILITY =
  'preflight.other-runtime-refusal.v1' as const

/** What such a host answers, instead of probing itself, for another runtime's workspace. */
export const WORKSPACE_ON_OTHER_RUNTIME = 'workspace_on_other_runtime'
