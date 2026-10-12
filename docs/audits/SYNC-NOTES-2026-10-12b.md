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
- CLI typecheck (`node node_modules/typescript/bin/tsc --noEmit -p config/tsconfig.tc.cli.json`): passed.
- Final key merge regressions: **155/155 passed**, 6 files.
- Changed-code quality root, casting and focused-plugin scans: zero new findings across **1,122 changed code files**. The type-aware scan reached approximately 4 GiB RSS and created memory pressure, so it was stopped; full local changed-code quality is unverified. CI's root/native/type-aware lint steps reported zero errors before its renderer typecheck failed.

## PR and same-branch CI repair

Initial PR: [#27](https://github.com/karlorz/orca/pull/27), merge head `0e0c48fd599f44bbca0bd17c323b743b947a573c`, parents exactly the fork base and upstream pin. The coordinator received PR/head/protocol/conflict/test evidence early.

Initial CI failures in the compiler comparison, PR static/typecheck job and Windows packaged build all report the same renderer error: `SetProjectLocationDialog.tsx:202` still passes `sshTargetId` to the shared `CreateProjectParentBrowser`. The AddRepo flow removed direct SSH placement, while the shared browser retains a separate project-location SSH caller. Restore the optional shared-browser prop and forward `targetId` into the existing listing authority. Preserve Linux local and server-owned SSH branches. Add explicit target-forwarding assertions to both existing-folder and clone journeys.

Repair verification: **16 tests passed**, 4 browser/location suites; scoped root lint and formatting passed. Full renderer typecheck remains assigned to ordinary CI because its measured compiler graph exceeds the practical local memory envelope. This repair uses a normal follow-up commit on the same PR branch.

The browser-repair head `7c0ffb6f86aac3c8a8d38d96b90c73e5b6f027e8` passed compiler comparison, static analysis/typecheck, Linux/Windows packaging, changed-spec and layout checks, managed SSH, mobile bundle and wire compatibility. Its five unit shards failed 16 assertions across seven files: five canonical skill fixtures still declared `stablyai/orca`, the WSL prompt expected that install URL, and the round-trip equality test supplied that source against the fork builder. Align these fixtures with `karlorz/orca`; retain foreign-source discrimination and add explicit upstream-source no-nudge and presence-only regressions. Product ownership and install commands remain intact.

Fixture repair verification: **86/86 passed**, eight Node suites; scoped root lint, formatting and diff whitespace checks passed. The first local invocation omitted the repository Vitest config and ran no tests; the corrected invocation uses `--config config/vitest.config.ts --project=node --maxWorkers=1`. A direct Bun attempt stopped before test collection because the installed musl Bun cannot load the glibc rolldown addon; Bun-runtime verification remains a CI gate. The CI `Cannot find module 'electron'` stderr belongs to the successful nine-test daemon startup-failure fixture.

Final offline safeguard batch: **89 passed, 3 explicitly skipped**, seven files. Its first attempt lacked the generated mobile terminal WebView script after the script-free install; running the existing offline WebView engine/document generators supplied the prerequisite, and the batch passed. Narrow type-aware lint on the browser repair passed. Whole-file design lint reported six inherited primitive restyles in the shared location component; changed-line checks reported zero new findings, and repaired-head CI static verification passed.

At fixture-repair head `897d839401aa15d47b6e03616e35e29b580548a5`, the mobile verify job (`114696036752`) passed 1,064 files and 10,335 assertions but failed on one unhandled `ReferenceError: window is not defined`. The stack identifies the 50 ms bridge retry in `document-host-seams.ts:151`, originating in `host-seams.test.ts` after its happy-dom environment ended. That fixture used real timers and restored globals while retries remained queued. Give the fixture fake-timer ownership, clear timers before returning to real time and restoring globals, and assert both the 100-attempt retry bound and single delivery when a bridge appears during retry. Production bridge behavior stays intact.

The original single-file Node invocation passed 14 tests; the unhandled teardown error was observed in CI's Bun run. The repaired document batch passed **69/69 tests** in nine files, with scoped mobile lint, formatting and whitespace checks passing. Broader offline skill verification at `897d8394` passed **878 tests, 43 skipped** across 114 passing files; narrow type-aware lint passed. Whole-file casting lint found 12 inherited assertions with byte-identical assertion lines against the prior head; the changed-line CI gate remains authoritative.

## Execution and review boundary

This checkout performs local integration and ordinary PR checks only. Parent coordinator owns independent review and final integration. macOS signing/packaging execution, release/tag creation, merge into fork-main, deployment, installed app/launcher/profile mutation and live GUI validation remain held. Synthetic Linux fixtures supply no signed macOS, Rosetta, arm64 or user-display evidence. Full cross-platform matrix and complete application validation remain ordinary CI gates.
