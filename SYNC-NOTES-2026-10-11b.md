# Sync notes: stablyai/orca `main` into `fork-main` (2026-10-11b)

Branch: `sync/upstream-2026-10-11b` from `origin/fork-main` (`079420eab9d`).
Merge: `upstream/main` @ `92fb883cf25` (`git merge --no-ff`).
At launch, fork-main was 105 behind / 626 ahead of upstream/main.

This is a follow-up to PR #17 (`sync/upstream-2026-10-11`). Do not merge this
PR. Do not cut tags. Do not touch Coolify.

## Policy

- Keep fork features listed in `config/fork-features.yml`.
- Re-apply #15/#17 resolutions where upstream re-touched the same files.
- Upstream wins for files the fork does not customize.
- Allowlisted auto-resolves: `.gitignore` union (drop leftover orphan comments).

## Conflict resolutions (7 paths)

### `.gitignore`

Union of ours and theirs. Dropped two orphan comment lines left from the
previous union (`# Local-only design/planning docs…` fragments). Kept
upstream's new ignores:

- `.build/preflight-benchmark/`
- `.local/static-analysis-research/`

### `config/scripts/pr-e2e-gate-contract.test.mjs`

Took upstream. Upstream removed the Docker-SSH source-routing tests along with
`hasSshSourceChange`, `SSH_SOURCE_ROUTE_IDS`, and the
`ssh-docker-watcher-isolation` job (`ff27338299e`). The fork-only edit in those
tests was `changed-e2e` timeout `>= 45` → `>= 60`; that assertion lived only
inside the deleted tests, so it cannot stay. The 60-minute shard still lives in
the workflow.

### `src/shared/protocol-version.ts`

Kept the fork spread `...FORK_TERMINAL_AND_AGENT_LAUNCH_RUNTIME_CAPABILITIES`
(terminal navigation/question + `automation.agent-flags.v1` + upstream
`AGENT_LAUNCH_RUNTIME_CAPABILITIES`). Added upstream
`SSH_TARGET_MANAGEMENT_RUNTIME_CAPABILITY` (`ssh.target-management.v1`).

### `src/renderer/src/components/sidebar/RemoteFileBrowser.tsx`

Kept the fork `local?: boolean` in-app picker (Linux GTK-less browse). Kept
optional `targetId` + `runtimeEnvironmentId` so both may be set (upstream:
server's own SSH host). Did not take upstream's exclusive union, because
`CreateProjectLocationField` passes `local={local}` with possibly undefined
ids.

### `src/renderer/src/components/sidebar/use-remote-file-browser-listing.ts`

Combined:

1. `local` → `repos.browseLocalDirectory` (fork)
2. both ids → `browseRuntimeSshDirectory` (upstream, server dials its SSH host)
3. `targetId` only → `ssh.browseDir` (this client's SSH host)
4. otherwise → `browseRuntimeServerDirectory`

### `src/renderer/src/components/sidebar/use-remote-file-browser-listing.test.ts`

Add/add: kept upstream happy-dom `renderHook` cases for server-owned SSH vs
client SSH vs server disk, plus the fork local-directory case.

### `tests/e2e/helpers/electron-process-shutdown.unit.test.ts`

Kept both:

- fork `readDaemonPidFiles` JSON/legacy pid-file cases
- upstream POSIX `cleanupE2EDaemons` SIGTERM/SIGKILL/descendant cases

## Auto-merged fork semantics kept

- `pet: 'host'` in `HOST_OPERATION_OWNERSHIP` (covers `pet.speak.*`)
- `AUTOMATION_AGENT_FLAGS_RUNTIME_CAPABILITY` in
  `automation-runtime-capabilities.ts` and the fork protocol spread
- automation-run open/resume/workspace-action (no upstream commits on those
  files in this 105-commit window; auto-merge kept fork)

## Light local checks

Recorded after the merge commit.
