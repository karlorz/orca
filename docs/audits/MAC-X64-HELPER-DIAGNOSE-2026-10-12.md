# Signed x64 terminal-helper bootstrap diagnosis — 2026-10-12

## Result and scope

Run [38196332957](https://github.com/karlorz/orca/actions/runs/38196332957), attempt 1, built exact source `b9200edd44b2c5659db277a5eb5a7ae1b0faa06f`. Its actual result was **15 jobs: 13 succeeded, 1 skipped, 1 failed**. The dispatch brief's counts were shorthand and incorrect. Failed package job: `114642429597`.

The isolated signed x64 helper failed the endpoint-readiness wait before connection, `createOrAttach`, or PTY creation. The underlying startup cause remains unresolved. This PR corrects a reproducible diagnostic defect: all incomplete endpoint states were reported as `no daemon token`, and the report provided no evidence of Node entry or whether the reported exit preceded verifier cleanup.

Work was restricted to the assigned branch `fix/mac-x64-helper-diagnose-2026-10-12`, based on `b9200edd`. The fork feature inventory (`config/fork-features.yml:223-231`) records the existing self-signed release mechanism; this diagnostic-only work adds no landed product feature.

## Retained evidence

The exact sanitized result is `/workspace/ops/fleet-status/mac-validation-38196332957/result.md:3-17`. The retained private package log is `job-114642429597.log` in that evidence directory. Raw logs remain local and private; this audit records bounded sanitized facts.

- Private log lines 4525-4526: native rebuild for darwin-x64 and x64 packaging.
- Lines 4529-4530: cross-architecture generic daemon-entry and skills probes skipped on the arm64 host. These skips supply no x64 helper-entry proof.
- Line 4545: terminal-helper bundle signing occurred before the boot check.
- Line 4546: endpoint wait failed after 20,030 ms; stages were `spawn-requested`, `waiting-for-endpoint`, and `daemon-stop-finished`. Create acknowledgement was missing, stream events/bytes were zero, stderr bytes were zero, and daemon-log status was unavailable. Exit signal was SIGTERM during verifier cleanup.
- Sanitized result lines 19-22: temporary identity removal and keychain restoration succeeded; final package verification and desktop artifact publication were not reached.

The old endpoint predicate required a socket pathname and a nonempty token file together. Its failure message did not identify which predicate failed. The retained evidence establishes failure before endpoint readiness; it cannot establish individual file absence, Node entry, or a precise internal bootstrap operation.

## Architecture and startup trace

| Area                             | Code evidence                                                                                                                                        | What it establishes and its limit                                                                                                                                                                                                                                                                                                                                                       |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Architecture selection           | `config/electron-builder.config.cjs:880-905`; `config/scripts/macos-terminal-host-bundle.cjs:315-328`                                                | Builder x64 enum maps to x64; assembly requests the pinned darwin-x64 Node and copies this slice's node-pty. The failed run did not reach final binary-architecture verification.                                                                                                                                                                                                       |
| Rosetta                          | `config/scripts/verify-packaged-daemon-entry.cjs:75-84`                                                                                              | On arm64, x64 execution requires successful `arch -x86_64 /usr/bin/true`, then uses that same prefix for the helper. Reaching the endpoint wait implies prefix admission succeeded. This checks translation availability; it does not prove the signed Node reached JavaScript.                                                                                                         |
| Self-signed and hardened runtime | `config/electron-builder.config.cjs:59-60,89-91,914-945`                                                                                             | The fork self-signed path has `isMacRelease=false`; this signer adds `--options runtime --timestamp` only for `isMacRelease`. The configured fork path therefore supplies no evidence of an enabled hardened-runtime flag. Actual retained signature flags are unavailable. A hardened-runtime entitlement diagnosis remains unproved.                                                  |
| Entitlements and signing         | `resources/build/entitlements.mac.plist:17-22`; `config/scripts/macos-terminal-host-bundle.cjs:326-328,389-405`                                      | Configured entitlements include allow-jit and unsigned executable memory; native addon, spawn helper, then bundle are signed inside-out. Final allow-jit, identifier/team and strict-signature checks occur after the PTY boot and were not reached. No signing policy changes are proposed.                                                                                            |
| Resources and isolation          | `config/scripts/macos-terminal-host-bundle.cjs:260-288`; `config/scripts/verify-packaged-daemon-entry.cjs:364-383`                                   | Helper contains Node, daemon JS with CommonJS metadata, dependencies and slice-specific node-pty; an APFS clone outside the build tree is executed. The clone retains its original contents and signature; the probe is created in separate verifier scratch. Resource-resolution drift remains possible and unproved.                                                                  |
| Paths and endpoint publication   | `config/scripts/verify-packaged-daemon-entry.cjs:174-215`; `src/main/daemon/daemon-endpoint-lifecycle.ts:61-83`                                      | Verifier uses a short `/tmp/oth-*` socket path and isolated user-data directory. Daemon publishes the owned socket before writing its token with mode 0600. Path permission or publication trouble is a hypothesis; the old report cannot resolve it. The helper has no configured app-sandbox entitlement.                                                                             |
| Entrypoint and daemon logging    | `src/main/daemon/daemon-entry.ts:9-31,113-137,350-353`; `src/main/daemon/daemon-ready-identity.ts:21-27`; `src/main/daemon/daemon-file-log.ts:47-67` | Static imports execute before main; main parses argv, awaits identity, then creates the fail-open log. On macOS identity returns without Linux boot lookup. Unavailable log evidence cannot prove main was never entered because logging itself may fail. Environment guards can suppress main, but the workflow does not configure them and no retained evidence proves they were set. |
| PTY/native module stage          | `src/main/daemon/pty-subprocess/native-pty-spawn.ts:9-10,38-46`; `config/scripts/verify-packaged-daemon-entry.cjs:252-310`                           | node-pty is dynamically loaded on PTY spawn; this attempt did not reach a terminal creation request. Existing shell readiness and native-PTY logic provide no causal proof for this earlier failure.                                                                                                                                                                                    |
| Timing and cleanup               | `config/scripts/verify-packaged-daemon-entry.cjs:70-73,160-172,239-250,319-338,373-376`                                                              | One absolute 20-second deadline covers bootstrap, authenticated dual connections and computed output. Verifier requests SIGTERM, then bounded SIGKILL if needed. SIGTERM in the retained report describes cleanup. Increasing timeout would supply no root-cause evidence.                                                                                                              |

No arm64 PTY success was reached: x64 boot failure aborts packaging before the arm64 slice's boot proof. The run supports no comparative claim that arm64 helper bootstrap succeeds.

## Minimal correction and proof

`config/scripts/verify-packaged-daemon-entry.cjs:180-215` writes a builtin-only CommonJS preload in private verifier scratch, loads it using Node's `--require`, and keeps the cloned packaged entry as the direct script. The preload writes only `process.arch`. It does not load packages from the build tree, modify the signed clone, inspect environment values, or create the endpoint/token.

`config/scripts/terminal-host-smoke-diagnostics.cjs:108-147,204-220` accepts only a regular, nonsymlink probe of at most 16 bytes containing the allowlisted `x64` or `arm64` architecture. It records separate socket/token file states using metadata, with no token contents. Evidence is captured before daemon-stop cleanup together with `exitedBeforeCleanup` and `stopRequested`. Timeout text now says `endpoint not ready`.

Captured bootstrap evidence proves the helper's Node ran the preload before the packaged module graph. It supplies no proof that daemon main ran. An unavailable probe remains inconclusive: native startup or probe writing could have failed. A preload introduces a small amount of work and may affect startup timing; it earns no separate deadline and cannot satisfy the PTY oracle.

Regression evidence:

- Before implementation, five new cases failed against the original verifier: four incomplete endpoint states received the same misleading token message; the successful direct-entry fixture had no bootstrap evidence.
- `config/scripts/verify-packaged-daemon-entry.test.mjs:186-279` verifies socket-only, token-only, empty-token and missing-both states; a module deliberately stalled before daemon logging; spontaneous exit versus verifier stop; direct script argv/main-module semantics; process and scratch cleanup.
- `config/scripts/terminal-host-smoke-diagnostics.test.mjs:86-139` verifies both architecture values, malformed and oversized records, symlink withholding, token metadata privacy and the existing 16 KiB/24-event log bounds.
- Existing regression cases continue to require shell-ready command delivery, split computed `OK 42`, reject command echo alone, and exercise a real Linux PTY with a startup profile read.

## Verification and limitations

All heavy local work used explicit glibc Node **24.21.0**, `ORCA_BACKGROUND_LAUNCH=1`, `heavy-run` with `HEAVY_RUN_MIN_FREE_MB=2048`, background commands and serial execution. The runner reported inability to join the heavy cgroup and remained in `/agent`; its memory admission, nice/ionice and heap cap still ran. Dependencies installed offline with frozen lockfile and ignored install scripts; process-host dist built successfully.

Focused command: `node node_modules/vitest/vitest.mjs run --config config/vitest.config.ts --maxWorkers=1` with these seven suites:

- `config/scripts/verify-packaged-daemon-entry.test.mjs`
- `config/scripts/terminal-host-smoke-diagnostics.test.mjs`
- `config/scripts/macos-terminal-host-bundle.test.mjs`
- `config/scripts/fork-mac-validation-workflow.test.mjs`
- `config/scripts/fork-desktop-voice-release.test.mjs`
- `config/scripts/verify-fork-mac-package.test.mjs`
- `config/scripts/check-runtime-launcher-protocol-ratchet.test.mjs`

Result: **7 suites passed; 74 tests passed; 10 existing macOS-only cases skipped**. The first full focused attempt passed 23/24 tests and exposed an absent local node-pty native binding. The existing installed Linux addon was then copied temporarily into ignored dependency scratch for the real-PTY test and removed after the run. This supplies Linux regression evidence only.

Changed-code quality: zero new findings across four code files. Scoped formatting passed. `git diff --check` passed. Protocol ratchet passed: base 45, candidate 45, no listed runtime-launcher files changed. The protocol/runtime override label is unnecessary. Full application typechecks/builds and the complete PR CI matrix are left to ordinary PR CI; their outcome must be reported separately at the final head.

The original 20-second computed PTY gate, signatures, clone isolation, authentication, readiness, cleanup, updater metadata, deployment template and wire protocol remain enforced. Changes affect packaging verification only; product execution on local, folder, SSH and independently updated peers is unchanged.

## Approval boundary and next evidence

Root cause and macOS recovery remain unresolved. A future parent-reviewed, exact-head, publication-disabled signed validation requires fresh Karl approval through the coordinator. Its bounded report can distinguish Node preload entry from an earlier bootstrap failure, individual endpoint-file states and verifier-induced process termination. If Node entry is captured but the daemon log remains unavailable, inspect the packaged module graph/main initialization next. If the probe is unavailable, assess native exec/translation/signature and probe-write possibilities without declaring causation.

This worker performs no signed rerun, workflow dispatch, merge, tag, release, publication, Mac interaction or live GUI validation. The coordinator owns escalation, the once-only merge gate, signed retest approval and review closure.
