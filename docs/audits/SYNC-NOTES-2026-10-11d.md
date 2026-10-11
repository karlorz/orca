# Sync notes: stablyai/orca `main` into `fork-main` (2026-10-11d)

Branch: `sync/upstream-2026-10-11d` from `origin/fork-main` (`cc1230a91d3`, PR #19).
Merge: `upstream/main` @ `b4aec8a8961` (`git merge --no-ff`).
Merge commit: `1e2fb380435`. Merge-base was `4468a5375f2`.

This is a follow-up to PR #19 (`sync/upstream-2026-10-11c`). Do not merge this
PR. Do not cut tags. Do not touch Coolify. Karl GO still stands to cut
`v1.4.224-0` after this PR merges.

## Policy

- Keep fork features listed in `config/fork-features.yml`.
- Re-apply #15/#17/#18/#19 resolutions where upstream re-touched the same files.
- Upstream wins for files the fork does not customize.
- Same relay-conflict discipline as 11c: SSH docker fixtures stay on the
  host names (`docker-ssh-host`); no leftover `docker-ssh-relay` paths.

## Upstream commits (5, oldest first)

- `bdc0921718b` test(e2e): one posixShellQuote; docker-ssh-host fixture names (#27449)
- `10d51086716` feat(runtime): accept a declared spawn intent from paired clients (#27452)
- `c9a9ad33b8e` test(e2e): one managed-host setup path and skip gate for the ssh-orcad specs (#27465)
- `3b49ee40db4` Update README downloads badge
- `b4aec8a8961` fix(sidebar): stop a removed folder workspace from leaving a blank row (#26376)

## Conflict resolutions

None. `git merge --no-ff upstream/main` auto-merged five overlapping files.
Verified each auto-merge kept fork deltas and added only the upstream
`spawnIntent` / `terminal.spawn-intent.v1` pieces:

- `src/shared/protocol-version.ts` — kept
  `SSH_TARGET_MANAGEMENT_RUNTIME_CAPABILITY` and
  `...FORK_TERMINAL_AND_AGENT_LAUNCH_RUNTIME_CAPABILITIES`; added
  `TERMINAL_SPAWN_INTENT_RUNTIME_CAPABILITY` after paired-parking.
- `src/shared/rpc-contract/agent-session-params.ts` — optional
  `spawnIntent: SpawnIntentParam`.
- `src/shared/agent-session-host-authority.ts` — optional `spawnIntent` on
  `RuntimeEnsureAgentSessionRequest`.
- `src/main/runtime/rpc/methods/terminal/terminal-lifecycle-methods.ts` —
  forward `params.spawnIntent` into ensure.
- `src/main/runtime/orca-runtime-get-agent-session-execution-namespace.ts` —
  forward `request.spawnIntent` into create.

## Auto-merged fork semantics kept

- `PET_SPEAK_METHODS` in `src/main/runtime/rpc/methods/index.ts`
- `pet.speak.subscribe` as a `'none'` relayed stream carrier
- Fork `orcad-host-adapters.ts` extraction
- Automation `agentFlags` / `activeView` (untouched by these five commits)

## CI follow-up

- Shard 3/5 bun: `daemon-init-provider-installation` first test
  (`re-binds listeners after the first daemon provider is installed`)
  finished in ~2.3s with `setLocalPtyProviderMock` at 0 calls. bun's first
  import after `vi.resetModules()` missed the hoisted `../ipc/pty` mock, so
  the real PTY barrel loaded. Re-pin that mock (plus `node:fs` / `node:net`)
  after reset and load `ipc/pty` before `daemon-provider-init`.

## Light local checks (this box, via `heavy-run`, glibc Node 22)

- `pnpm install --ignore-scripts` then `pnpm --filter @orca/process-host build`.
- `tsc --noEmit -p config/tsconfig.tc.cli.json`: clean.
- vitest `--config config/vitest.config.ts --maxWorkers=1`:
  - spawn-intent + host-spawn-admission + rpc errors: 73 passed.
  - worktree / folder-workspace metadata: 25 passed.
  - e2e routing + global-setup-cli-artifact: 15 passed.
  - pet-speak replay + mobile method routing: 4 passed.
- Full `pnpm tc` (node+web) and electron-builder not run locally.
