# Pinned upstream sync: 2026-10-12a

## Inputs and ancestry

- Fork base: `e5c905aecc28678da0709221c740944d10fa43a7` (merged PR #21).
- Pinned upstream second parent: `47c93636af7424b612974e01cf8aac5c7d4e4640`.
- Branch: `sync/upstream-2026-10-12a`; PR target: `karlorz/orca` `fork-main`.
- The assigned worktree started clean at the exact fork base; the fork had zero open PRs during duplicate checking.
- Fetched `origin fork-main` and `upstream main` explicitly. Upstream had advanced to `f0b310b1b134aae807bbcf5631be1b0e19a40c15`; this sync includes only the authorized pinned tip (64 commits beyond the fork base).
- Merge command: `git merge --no-ff 47c93636af7424b612974e01cf8aac5c7d4e4640`.
- Merge and release remain coordinator/Karl-gated.

## Conflict decisions

| Path | Resolution |
| --- | --- |
| `cloud/apps/relay/src/relay-server.ts` | Retain fork `keyExpiryDisabled` credential-store option and upstream dead-cell poll evidence, with upstream stale-key verifier integration. |
| `config/electron-builder.config.cjs` | Package upstream macOS terminal host before sealing the fork self-signed app. Combine fork signing identity, upstream terminal-host signing exclusions, centralized folder usage descriptions, and fork speech-recognition usage description. |
| `src/main/runtime/rpc/methods/index.ts` | Register both upstream `AUTOMATIC_WORK_METHODS` and fork `PET_SPEAK_METHODS`. |
| `src/renderer/src/components/terminal-pane/ipc-pty-connect.ts` | Keep fork definitive queued-resume spawn rejection callback with upstream disposed-spawn cleanup name and host-owned transport flow. |
| `src/renderer/src/components/terminal-pane/pty-connection/fresh-spawn-start.ts` | Preserve queued-resume rejection and upstream deferred-spawn remount prevention. Use the upstream single-argument settlement signature for both failure paths. |

## Fork preservation

Read `config/fork-features.yml` before resolving conflicts. The fork home AppImage installer, launcher, verification, release policy, protocol-gated updater, and Linux update policy files remain intact. Upstream updater auto-merges add supervised macOS serve staging while retaining the fork home-install branch and feeds. Fork desktop/mobile release workflows, update protocol metadata writer, and feature inventory are unchanged. Desktop release workflow still builds and downloads `orcad-template` for all desktop platforms and publishes `orca-update-protocol.json`.

The shared runtime capability manifest retains fork terminal/agent-launch and SSH-target capabilities. Pet speech retains execution-host ownership and its RPC manifest entry. Fork automation flags, recorded outcomes, resumed-session handling, and Grok model-effort launch changes remain present. Upstream owns uncustomized files, including removal of legacy SSH-provider branches.

## Mobile prerequisite

- Coordinator supplied the existing APK prerequisite before dispatch. Independently confirmed `mobile-android-v0.0.52-3` contains `orca-mobile.apk`, size **136088813 bytes**.
- `node config/scripts/fork-upstream-trains.mjs` reports newest published upstream mobile train `mobile-android-v0.0.52` (published `2026-10-03T00:39:14Z`, prerelease) and desktop `v1.4.224`.
- `mobile/app.json` is unchanged from the fork base; marketing version remains `0.0.52`, with unchanged nondecreasing Android versionCode.
- Mobile source and shared transport paths changed; focused local mobile/shared validation follows on this branch. Mobile tagging remains with the coordinator.

## Runtime launcher/protocol guard

Command:

```sh
node config/scripts/check-runtime-launcher-protocol-ratchet.mjs --base e5c905aecc28678da0709221c740944d10fa43a7
```

Observed daemon protocol **44 → 45**, from `src/main/daemon/daemon-protocol-version.ts`, together with these guarded launcher changes:

- `src/shared/node-runtime-pin.ts`
- `src/main/daemon/daemon-launched-child.ts`
- `src/main/daemon/daemon-launched-child-spawn.ts`
- `src/main/daemon/daemon-out-of-process-launcher.ts`

The unoverridden guard fails as expected. The dispatch explicitly authorizes the sync-only label `allow-runtime-launcher-protocol-bump`. Running the same guard with `ORCA_ALLOW_RUNTIME_LAUNCHER_PROTOCOL_BUMP=1` succeeds with `OVERRIDDEN`. Apply the label when the PR opens and before the next normal push so CI reads it. Live launcher switching remains attended.

## Local evidence

Heavy work is serialized using `heavy-run`, with its default 2048 MiB free-memory admission floor and 2048 MiB Node heap cap. Initial MemAvailable was approximately 6041 MiB. The runner could not join the host `/heavy` cgroup and retained `/agent`; nice/idle-I/O scheduling still applies. Tests use `ORCA_BACKGROUND_LAUNCH=1` and glibc Node 22.19.0.

- `pnpm install --ignore-scripts --frozen-lockfile`: passed, pinned pnpm 12.8.1; local corepack cache used because the default system cache is unwritable.
- `pnpm --filter @orca/process-host build`: passed, 68 output files.
- `node --check config/electron-builder.config.cjs`: passed.
- `git diff --check --cached`: passed.
- `node node_modules/vitest/vitest.mjs run --config config/vitest.config.ts --maxWorkers=1` with fork desktop/mobile release, fork sync, protocol guard, macOS usage-description/terminal-host packaging, home installer/updater/policy, Linux home policy, queued-resume/unbound-pane, and spawn-error tests: **13 files passed; 136 tests passed, 12 skipped**.
- An initial `node --test` invocation failed because these suites import Vitest; the corrected repository-configured Vitest invocation above passes.

Further mobile/shared tests, real Claude CLI tests, code quality and practical type checks will be recorded in normal follow-up commits. Full desktop builds, live installs, and local GUI launches are outside this dispatch; CI provides the broader verification matrix.
