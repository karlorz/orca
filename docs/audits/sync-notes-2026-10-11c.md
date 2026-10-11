# Sync notes: stablyai/orca `main` into `fork-main` (2026-10-11c)

Branch: `sync/upstream-2026-10-11c` from `origin/fork-main` (`e51d0a0ef4f`, PR #18).
Merge: `upstream/main` @ `4468a5375f2` (`git merge --no-ff`).
At launch, the brief named 55 commits behind `6d516517115`. Fetch moved
upstream/main one commit further (`#27450` phone wake for hibernated panes), so
this merge is **56** commits.

This is a follow-up to PR #18 (`sync/upstream-2026-10-11b`). Do not merge this
PR. Do not cut tags. Do not touch Coolify.

## Policy

- Keep fork features listed in `config/fork-features.yml`.
- Re-apply #15/#17/#18 resolutions where upstream re-touched the same files.
- Upstream wins for files the fork does not customize.
- Same relay-conflict discipline as 11b: after relay deletion, SSH fixtures
  stay under `src/main/ssh/` (upstream now owns those names).

## Conflict resolutions (6 paths)

### `config/scripts/node-server-change-scope.test.mjs`

Took upstream. 11b had pointed leftover `src/relay/…` fixtures at
`src/main/ssh/agent-status-store.ts`. Upstream `#27392` already moved those
fixtures to `src/main/ssh/pinned-runtime-materializer.ts` and
`pinned-runtime-materializer-context.test.ts`. Keep those names.

### `src/main/orcad/orcad-entry.ts`

Kept the fork extraction: host adapters live in `orcad-host-adapters.ts`
(re-exported from `orcad-entry.ts`). Did not restore upstream's inlined
`createNodeAppEnvironment` / `createNodeSecretStore`.

Took upstream's `daemonOwnsFreshPersistentPtys` import from
`daemon-provider-state` (upstream deleted `daemon-init.ts`). Kept the fork
`agentHookServer.setSessionTerminalOwnerResolver` wiring.

Wired upstream `#27441` (`describeOrcadSecretProtectionGap`) into
`orcad-host-adapters.ts` so the Node secret store no longer claims
"this host has no OS keyring" on macOS/Windows.

### `src/main/runtime/rpc/methods/index.ts`

Kept both:

- upstream `MOBILE_RELAY_HOSTS_METHODS` (`mobileRelay.hosts.*`)
- fork `PET_SPEAK_METHODS`

### `src/main/runtime/runtime-rpc/runtime-rpc-lifecycle.ts`

Kept upstream `mobileDesktopRelay.closePhoneConnection` on socket close, then
the fork pet-speech device-registry cleanup already auto-merged after it.

### `src/main/runtime/runtime-rpc/runtime-rpc-mobile-method-allowlist.ts`

Took upstream: allowlist is now `new Set(MOBILE_RPC_METHOD_ROUTES.keys())`.
Added the five fork `pet.speak.*` methods to `EXECUTION_HOST_METHODS` in
`runtime-rpc-mobile-method-routing.ts` (`pet: 'host'`), so the derived
allowlist still authorizes the phone pet-speech RPCs.

### `src/renderer/src/components/automations/use-automations-page-store-state.ts`

Combined:

- fork `activeView` (Escape while View-run keeps the page mounted)
- upstream `folderWorkspaces` (folder-workspace automation targets, `#27416`)
- upstream `unifiedTabsByWorktree` / `terminalLayoutsByTabId` / `ptyIdsByTabId`

## Auto-merged fork semantics kept

- `pet: 'host'` in `HOST_OPERATION_OWNERSHIP` (plus new upstream `mobileRelay: 'host'`)
- `FORK_TERMINAL_AND_AGENT_LAUNCH_RUNTIME_CAPABILITIES` spread (terminal
  navigation/question + `automation.agent-flags.v1` + agent-launch)
- `SSH_TARGET_MANAGEMENT_RUNTIME_CAPABILITY`
- DeepSeek picker / `agentFlags` launch tests and relay-install retry tests
  were not in the conflict set; auto-merge kept them.

## Light local checks (this box, via `heavy-run`, glibc Node 22)

- `pnpm install --ignore-scripts` then `pnpm --filter @orca/process-host build`.
- `tsc --noEmit -p config/tsconfig.tc.cli.json`: clean.
- vitest `--maxWorkers=1`:
  - `node-server-change-scope.test.mjs`: 98 passed (first run failed on fork `daemon-init` import; fixed to `daemon-provider-state`).
  - routing + `mobile-rpc-allowlist` + pet-speak allowlist/status: 13 passed.
  - automations folder hook + orcad forked-child paths + secret-protection-gap: 7 passed.
- Full `pnpm tc` (node+web) and electron-builder not run locally.
