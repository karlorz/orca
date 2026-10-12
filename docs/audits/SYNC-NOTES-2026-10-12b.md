# Pinned upstream sync — 2026-10-12b

## Scope and ancestry

This sync targets one PR into `karlorz/orca` `fork-main`, on `sync/upstream-2026-10-12b`.

- Fork base: `18b802146346a70d80d931730e405dd60c7af781` (PR #26).
- Pinned upstream: `ae0ff6315219fa0492bd2e874954f992bc859694`.
- Both commits were fetched and the isolated checkout was clean at the fork base.
- `git rev-list --count <base>..<upstream>` reports **74** upstream commits. The dispatch brief's 274 count differs from the pinned graph; the coordinator received the verified count.
- The merge uses `git merge --no-ff --no-commit <upstream>` followed by a normal merge commit. Its two parents retain the fork base and exact upstream ancestry.
- No open PR existed at the initial check. Push destination is the fork remote only.

## Conflict decisions

The merge conflicted in 22 paths:

| Paths | Resolution |
| --- | --- |
| `AGENTS.md` | Preserve all fork release and background-launch rules; incorporate upstream native-chat design enforcement. |
| `.github/workflows/e2e.yml`, `config/scripts/ci-e2e-job-selection.test.mjs` | Preserve fork three-way changed-spec sharding, 60-minute cap and non-fail-fast matrix; combine shard identity with upstream artifact suffix and managed-SSH exclusions. |
| `src/cli/skills.test.ts`, `src/shared/agent-feature-install-commands.test.ts` | Adopt upstream pinned CLI/build-commit install tests with the fork repository. |
| Onboarding feature setup, BrowserUseSkillStep, OrchestrationPane and linear skill install CTA tests | Adopt upstream pinned install/update rail with fork-owned source expectations. |
| SkillFreshnessUpdateDialog, skill-freshness-grouping, skill-freshness-skipped-reason and skill-freshness-display-status tests/code | Adopt upstream manifest schema 3 and build-commit installs. Preserve owner-managed external-link drift filtering and regression coverage for genuine read failures. Recognize the fork's lock source. |
| AddRepoCloneStep, AddRepoCreateStep, AddRepoDialog, CreateProjectLocationField | Preserve Linux in-app local folder browsing while adopting upstream execution-host routing and removal of direct SSH client placement. |
| `src/main/daemon/daemon-init-dependency-mocks.ts` | Combine upstream real filesystem constants with fork mocked chmod/lstat operations; keep fake filesystem and process operations isolated. |
| `src/main/ssh/ssh-remote-commands.test.ts` | Adopt upstream sorted filesystem membership assertion, equivalent to the fork fix. |
| `use-terminal-pane-global-effects.ts` | Preserve fork dictation insert/replace hook. Remove obsolete worktree argument from its paste calls and replacement tests to match upstream transport-owned paste routing. |

The automatically merged skill source initially composed `.../tree/fork-main/tree/<commit>`. The repository constant now names `https://github.com/karlorz/orca`; the upstream installer appends the exact build commit once. Skill updater and inventory fixtures verify the fork-owned source. CC-Switch alias classification remains present.

## Fork safeguards

- `config/fork-features.yml` is unchanged. Fork terminal/agent launch capabilities and `pet.speak.*` execution-host routing remain present.
- PR #23/#24/#26 packaged-helper readiness, bounded diagnostics and bootstrap probe, PR #25 publication-disabled exact-head wrapper/shared packager, fork release workflows, signing identity policy, Linux home installer/launcher and protocol-gated updater policy are byte-unchanged against the fork base. Upstream's updater setup accepts a nullable window for headless serving while retaining an existing attached window.
- Daemon endpoint ownership rules and remote mixed-version capability negotiation remain applicable. Upstream device-key capability additions retain existing fork capability entries.
- Runtime-launcher ratchet (`config/scripts/check-runtime-launcher-protocol-ratchet.mjs`) against the exact fork base reports daemon protocol **45 → 45**. Changed listed launcher paths: `config/scripts/orcad-entry-build.mjs`, `src/main/ssh/orcad-remote-node-runtime.ts`, `config/scripts/build-orcad.mjs`. The ratchet passes, so the override label is unnecessary. Its checker, tests and override policy remain enforced.
- Published upstream Android train was verified through GitHub Releases as `mobile-android-v0.0.52`. Non-draft fork release `mobile-android-v0.0.52-3` already supplies `orca-mobile.apk` (136,088,813 bytes). `mobile/app.json` stays version `0.0.52`, versionCode **86**. No mobile build, phone launch or tag is required for this sync.

## Local verification

Heavy commands acquire `/tmp/coord-pl-1157-heavy.lock`, then check `MemAvailable >= 2097152 KiB` inside the lock, then run `heavy-run` with explicit glibc Node **24.21.0**, pnpm **12.8.1**, `ORCA_BACKGROUND_LAUNCH=1` and Vitest `--maxWorkers=1`. The runner could not join the heavy cgroup and retained its existing process cgroup; memory admission, low priority and Node heap cap remain active. Commands run in the background with captured logs.

- Frozen root dependency install with lifecycle scripts disabled: passed.
- `pnpm run build:packages`: passed (process-host dist).
- First offline fork/skill/updater/ratchet regression batch: **941 passed, 53 skipped, 2 failed** across 115 files. Both failures were inventory fixture ownership assertions still using the upstream repository; the fixtures were corrected to the fork source.
- Second focused resolution/inventory/renderer/daemon/diagnostics batch: **167 passed, 1 skipped**, 11 files passed. The skip explicitly excludes the real-native-PTY fixture because the script-free install supplies no rebuilt `pty.node`.
- Runtime-launcher/protocol ratchet: passed, protocol 45 on both sides.
- Scoped formatting and `git diff --check`: passed before the merge commit.
- Changed mobile/shared tests: **25 shared tests passed** (2 files), **133 mobile tests passed** (12 files), including pairing, stream resubscription, keyboard/refit, APK updater and pet speech. Frozen mobile install with lifecycle scripts disabled passed.
- Code-quality/type checks: pending at initial PR creation; subsequent evidence will be recorded below.

## Execution and review boundary

This checkout performs local integration and ordinary PR checks only. Parent coordinator owns independent review and final integration. macOS signing/packaging execution, release/tag creation, merge into fork-main, deployment, installed app/launcher/profile mutation and live GUI validation remain held. Synthetic Linux fixtures supply no signed macOS, Rosetta, arm64 or user-display evidence. Full cross-platform matrix and complete application validation remain ordinary CI gates.
