# macOS packaged terminal-host smoke recovery — 2026-10-12

## Scope and failure evidence

- Base: `2330847fbefdc48ace0067b19ce925e35cd5def5` (`fork-main` and immutable `v1.4.224-2`).
- Recovery branch: `fix/mac-terminal-host-smoke-2026-10-12`.
- Failed run: https://github.com/karlorz/orca/actions/runs/38175318730
- Failed job: https://github.com/karlorz/orca/actions/runs/38175318730/job/114580948356
- The x64 helper ran on an arm64 `macos-15` runner through Rosetta. It authenticated control and stream connections and returned only `echo "OK $((6*7))" && exit`; the 20-second computed-output check failed.
- stderr also reported a failed macOS login preflight and direct shell fallback. The log establishes degraded attribution; it does not establish that warning as the cause of command loss.
- Linux, Windows, and every orcad-template job succeeded; release publication was skipped.

## Proven contract defect and mechanism

1. The old smoke supplied `command` without `shellReadySupported` (`config/scripts/verify-packaged-daemon-entry.cjs`, base lines 239–246).
2. POSIX launch planning selects the readiness wrapper for ordinary startup commands (`src/main/daemon/pty-subprocess/shell-launch-plan.ts:199–225`).
3. Session creation defaults the omitted readiness flag to false (`src/main/daemon/terminal-host-session-create.ts:173–177`) and writes the startup command immediately (`:244–267`). The session therefore permits stdin before the shell's first prompt.
4. The existing barrier queues stdin until the wrapper's prompt marker and owns startup terminal-query responses (`src/main/daemon/session-shell-ready-barrier.ts:53–70,103–122`; `src/main/daemon/session.ts:143–156`).
5. A controlled Linux Bash profile containing `IFS= read -r -t 0.5 startup_input || true` consumes the early command. The unchanged verifier against the current-source daemon timed out with the literal command echo and an idle `ready>` prompt. With `shellReadySupported: true`, the identical real PTY fixture returned computed `OK 42` in under one second.

This proves a startup-contract defect in the verifier and reproduces the failure class. The exact macOS runner profile or initialization operation that consumed the release command remains unverified. A normal Linux baseline without the controlled profile passed, which confirms timing/environment sensitivity.

Fresh sessions return a null snapshot and stream their output (`src/main/daemon/terminal-host-session-create.ts:270–278`; `src/main/daemon/daemon-terminal-admission.ts:190–209`). The observed input echo also proves the stream connection delivered bytes. No snapshot workaround is required by the reproduction.

## Minimal fix and preserved gate

- Send the existing `shellReadySupported: true` field in the smoke request (`config/scripts/verify-packaged-daemon-entry.cjs:249–251`). Product runtime and daemon protocol remain unchanged.
- Reject an explicit failed create response immediately and include it in the existing cleanup path (`:231–238,255–270`). Previously it was only appended to stderr while the verifier waited until timeout.
- Keep arithmetic `echo "OK $((6*7))" && exit` and computed `OK 42`, the 20-second deadline, authenticated dual connections, isolated packaged helper clone, x64/Rosetta requirement, and daemon/scratch cleanup.
- Packaging and signing order remain intact: helper assembly and inside-out signing precede required PTY execution and signature verification (`config/electron-builder.config.cjs:890–912`; `config/scripts/macos-terminal-host-bundle.cjs:304–329`). Fork outer signing, template packaging, and update protocol metadata are unchanged.

## Regression coverage

`config/scripts/verify-packaged-daemon-entry.test.mjs:166–246` covers:

- Ready-gated request and split computed output from shell execution.
- Current-source daemon serving a real native PTY with a profile reading during startup.
- Echoed input without computed output, silent command delivery, explicit create rejection, hung hello, closed connection, and malformed JSON.
- Daemon exit and scratch removal on success and every failure case.

The verifier suite is assigned to the Node runtime project in `config/scripts/vitest-node-runtime-files.mjs` because it now launches the native PTY daemon even when CI uses Bun as its test coordinator.

## Commands and observed results

Every heavy command used `heavy-run` (memory admission floor 2048 MiB), ran in the background with `ORCA_BACKGROUND_LAUNCH=1`, and ran serially. The runner could not join the shared heavy cgroup and retained its low-priority process settings. No app or GUI was launched.

- `pnpm install --ignore-scripts --frozen-lockfile`: passed using pnpm 12.8.1 and glibc Node 22.19.0.
- `pnpm run build:packages`: passed.
- Current-source daemon reproduction bundle: `node node_modules/esbuild/bin/esbuild src/main/daemon/daemon-entry.ts --bundle --platform=node --format=cjs --packages=external --outfile=/tmp/orca-mac-smoke-daemon.cjs`: passed.
- The local compiler toolchain lacks C++; reproduction used a scratch copy of the installed Linux `pty.node` with the checkout's node-pty JavaScript. The installed addon loaded under the test Node. This exercises current daemon source and real PTY I/O, with native rebuild/package proof deferred to CI.
- An initial installed-daemon attempt rejected protocol 45; that attempt provided no startup evidence. The subsequent current-source daemon used protocol 45 successfully.
- Baseline focused suites: 20 passed, 1 skipped.
- New regressions against the unchanged verifier: 2 failed, 11 passed (ready-gated output and immediate create rejection failed as expected).
- Controlled real-PTY reproduction: old request timed out; ready-gated request passed.
- `node node_modules/vitest/vitest.mjs run --config config/vitest.config.ts --maxWorkers=1 config/scripts/verify-packaged-daemon-entry.test.mjs src/main/daemon/terminal-host-startup.test.ts src/main/daemon/agent-startup-prompt-latency.node-pty.test.ts src/main/daemon/session.test.ts config/scripts/macos-terminal-host-bundle.test.mjs config/scripts/fork-desktop-voice-release.test.mjs`: **107 passed, 11 skipped across 6 suites**. Skips belong to existing platform/benchmark-specific tests; the new real-PTY regression ran.
- `node_modules/.bin/oxfmt --write` on the three changed code files: passed.
- `node config/scripts/check-changed-code-quality.mjs 2330847fbefdc48ace0067b19ce925e35cd5def5`: passed with zero new findings across all configured scans.

## Review and release gate

The fork PR is subject to coordinator review, normal PR CI, and the attended fork merge gate. Genuine signed macOS x64/Rosetta and arm64 package execution remains a GitHub CI validation requirement. Ordinary PR CI does not package self-signed macOS. The coordinator must resolve that evidence gap before treating macOS recovery as verified; a build-only diagnostic workflow would need a scoped reviewed change with publication disabled. Existing release/adhoc workflows cannot be used casually because they publish or require release authority.

No merge, tag, retag, release, publication, installation, restart, upstream push, account change, or user's Mac access was performed. The coordinator owns the next-free release after an approved merge.

## Delegation correction

A read-only startup-contract scout was launched, then cancelled following the coordinator correction. `kill_command_or_subagent` returned `already_exited: Subagent already cancelled`; its recorded tools were reads/searches and the worktree was clean. Its output supplied no accepted evidence. Diagnosis, reproduction, edits, and verification were completed in the assigned coding tab with no further agents.
