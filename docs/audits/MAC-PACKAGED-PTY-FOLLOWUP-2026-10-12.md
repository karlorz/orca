# Packaged macOS PTY second-failure follow-up — 2026-10-12

## Finding and remaining evidence gap

Base: `8778814b8feacf6067a3e45cec7624be3432163b` (PR #23). Branch: `fix/mac-packaged-pty-followup-2026-10-12`.

Run https://github.com/karlorz/orca/actions/runs/38182641904, macOS job `114600905121`, failed at `2026-10-11T23:46:42Z` in **Package self-signed macOS**. The required signed x64 helper clone on the arm64 `macos-15` runner timed out waiting for computed `OK 42`, with empty output and no captured stderr. Linux, Windows, and the full deployment-template matrix passed; publication was skipped. The brief reports release `v1.4.224-3` absent and the existing tags immutable.

This establishes no delivered PTY stream bytes. It does not establish whether create completed, which shell operation stalled, whether the readiness timer started, or whether the native PTY produced bytes. PR #23 repaired a demonstrated early-input contract defect; it did not establish the exact macOS cause. This follow-up repairs the proven diagnostic gap. A product-runtime repair needs the genuine macOS evidence below.

## Startup trace

- The helper contains pinned Node, copied `out/main`, recursively resolved daemon packages, and slice-specific node-pty including executable spawn-helper (`config/scripts/macos-terminal-host-bundle.cjs:79–108,126–171,262–289`). The module walk resolves relative JS loads and rejects computed loads; isolation prevents ancestor checkout dependencies from satisfying missing packages.
- Shell wrappers are generated from bundled strings into isolated user-data `shell-wrappers`, with content-addressed roots and nonempty-file checks (`src/main/daemon/shell-ready.ts:29–96`; `src/main/daemon/daemon-shell-ready-wrapper-fileset.ts:18–38`). They are not external resource files expected beside the app. Bash's wrapper sources system and user login profiles; zsh restores the user's startup directory.
- POSIX launch planning resolves the effective shell, selects readiness features, and creates its wrapper arguments (`src/main/daemon/pty-subprocess/shell-launch-plan.ts:190–225`). macOS login preflight may choose wrapped or direct spawn; positional trampolines preserve argv (`src/main/providers/macos-tcc-login-shell.ts:201–229,325–379`). Changing that strategy lacks causal evidence here.
- The server returns successful create metadata in **payload**; exceptions return `ok: false` and an error (`src/main/daemon/daemon-server.ts:293–313`). Successful authentication precedes create and cannot prove spawn success.
- A fresh session attaches its stream client and queues the command through the existing readiness barrier (`src/main/daemon/terminal-host-session-create.ts:173–177,224–278`). The barrier answers startup device-attributes queries directly, then releases queued stdin on readiness or its 15-second timeout (`src/main/daemon/session-shell-ready-barrier.ts:53–70,110–133,214–230`). A timeout is durably logged.
- Durable lifecycle/readiness logs exist only when `--log-file` is supplied; the failed verifier omitted it (`src/main/daemon/daemon-entry.ts:67–69,136–137,298–313`; base verifier `config/scripts/verify-packaged-daemon-entry.cjs:184–188`). The log is synchronous, private-mode, rotated, and fail-open (`src/main/daemon/daemon-file-log.ts:98–126`). Existing stream fan-out and session exit are logged (`src/main/daemon/daemon-terminal-admission.ts:170–185,190–230`).

The 15-second readiness timeout should release queued input after Session construction. Empty output alone cannot prove that construction or timer occurred. Increasing the 20-second gate, suppressing the failure, or changing shell flags would therefore be speculative.

## Scoped change and privacy

`config/scripts/verify-packaged-daemon-entry.cjs:171–321` now passes the existing `--log-file` option pointing inside its own temporary directory and captures the diagnostic report before removing that directory. No product source or wire protocol changes.

`config/scripts/terminal-host-smoke-diagnostics.cjs` records:

- Requested shell family basename (`bash`, `zsh`, `fish`, `sh`, or `custom`), elapsed stage times, create acknowledgement (`missing`, `accepted`, `rejected`), and the acknowledged shell state.
- Stream event and byte counts, first data time, PTY exit code, and daemon exit code/signal. The daemon exit includes verifier cleanup; elapsed stages distinguish it from pre-cleanup PTY exit.
- stderr byte count and booleans for module-load, wrapper-write, and login-preflight failures. Raw stderr remains private.
- At most the last 16 KiB of the isolated NDJSON log and 24 known events. Only numeric/boolean fields and fixed safe words are exported. Paths, account identifiers, HOME, profiles, environment, tokens, command text, arbitrary error messages, and raw PTY bytes are withheld.

The log reader uses a nonblocking descriptor, requires a regular file, skips malformed/partial lines, and fails open. Capture failure preserves the smoke failure and cleanup. Original failure class remains visible, with private details withheld. Stream accumulation retains a bounded suffix while computed output is detected before truncation.

Preserved gates: computed arithmetic `echo "OK $((6*7))" && exit`, actual `OK 42`, the 20-second deadline, authenticated control and stream pair, helper clone outside the build tree, required x64/Rosetta and arm64 execution, inside-out signing and signature checks, and daemon/scratch cleanup (`config/scripts/verify-packaged-daemon-entry.cjs:67–81,156–169,326–358`; `config/electron-builder.config.cjs:890–912`).

## Regressions and local verification

- Verifier tests distinguish missing create acknowledgement from an acknowledged empty PTY, immediate rejection, and log-capture failure with cleanup. Existing computed split-output, real startup-profile PTY, literal echo, silent delivery, hung hello, closed connection, and malformed JSON tests remain (`config/scripts/verify-packaged-daemon-entry.test.mjs:186–305`).
- Both verifier and diagnostics suites are explicitly assigned to the Node runtime project in `config/scripts/vitest-node-runtime-files.mjs:8–9`, including when Bun coordinates CI.
- Diagnostic tests cover filtered lifecycle/readiness events, stage/ACK/exit evidence, private-content withholding, malformed lines, a large log bounded to 16 KiB/24 events, and unavailable logs (`config/scripts/terminal-host-smoke-diagnostics.test.mjs:16–101`).
- Existing Session tests prove 15-second timeout flush and a throwing diagnostic sink still releases stdin (`src/main/daemon/session.test.ts:594–639`). Existing wrapper tests regenerate missing wrapper files (`src/main/daemon/shell-ready.test.ts:168–200`).

All heavy work runs serially through `heavy-run`, memory floor 2048 MiB, explicit glibc Node `/home/box/.local/opt/node-v22.19.0-linux-x64/bin/node` and PATH, `ORCA_BACKGROUND_LAUNCH=1`, and Vitest `--maxWorkers=1`. The runner cannot join the heavy cgroup and retains its low-priority settings.

- Frozen dependency install with scripts disabled: passed. `pnpm run build:packages`: passed.
- First focused run: 16 passed, one real-PTY failure because this box has no rebuilt `pty.node`. This was a dependency limitation, and diagnostic output correctly reported create rejection.
- The allowed installed `/opt/Orca/resources/node_modules/node-pty/build/Release/pty.node` was copied only into ignored dependency scratch. It loaded under explicit glibc Node. The real-PTY test then passed against current daemon source. This supplies Linux I/O evidence; native rebuild and macOS package proof remain CI gates.
- Seven focused suites: **127 passed, 14 existing platform-dependent skips**. Suites: verifier, diagnostics, Session, terminal-host startup, shell-ready wrappers, macOS helper bundle, fork desktop workflow. New diagnostics and real-PTY tests executed.
- After adding the explicit Node runtime assignment, verifier and privacy suites reran **19/19 passed**. Runtime-boundary tests passed the exposed-GC ownership check and failed their existing Node >=24 requirement under the brief-required Node 22.19; that CI-runtime contract remains for ordinary CI. A direct source assertion confirmed the diagnostics file is in `NODE_RUNTIME_INCLUDE`.
- Scoped `oxlint`, `oxfmt`, and `git diff --check`: passed. Changed-code-quality gate against `8778814b8feacf6067a3e45cec7624be3432163b`: passed with zero new findings.

## PR #24 CI repair — closed-peer write race

Initial PR Checks run `38187566151`, attempt 1, job `114613745870` (Node 24 shard 3/5), failed only the closed-peer verifier assertion at `config/scripts/verify-packaged-daemon-entry.test.mjs:292`. The server deliberately destroys the control socket; the OS returned `write EPIPE`, and the report showed cleanup completed in 115 ms. The assertion accepted close and `ECONNRESET` but omitted the legitimate write-side broken-pipe result.

The follow-up changes that assertion to accept the precise `write EPIPE` word-bounded error and updates its one-line comment (`:291–292`). The existing below-deadline, daemon-exited, and scratch-removed assertions stay intact (`:293–295`). Product code, computed-output requirement, deadline, and cleanup are unchanged. A successful old-head retry cannot replace this durable regression correction.

Verification ran serially with the same memory floor/background policy and disclosed installed PTY fixture:

- Verifier plus diagnostics, explicit glibc Node 22.19.0: **five repetitions, 19/19 passed each**.
- The same suites under available glibc Node 24.21.0: **three repetitions, 19/19 passed each**.
- Unchanged plugin reconciliation suite under glibc Node 24.21.0: **three repetitions, 11/11 passed each**.

### Shard 5 abort investigation and limits

Initial job `114613745829` ended with a Vitest fork-worker `SIGABRT` while running `src/main/plugins/plugin-service-reconciliation.test.ts`, with 23,580 tests passed and one unhandled worker error. The log supplies no plugin assertion failure, crash backtrace, allocator failure, or causal out-of-memory evidence. The runner was `ubuntu-24.04-arm`, image `20261004.142.1`, Bun `1.4.2+744846f84`, using four workers. Plugin code/tests, shared plugin code, Vitest config, Bun pin, and lockfile are byte-unchanged against both the requested base and the earlier sync head `290db4003dc36db88466ef066893dc3a979cb562`.

Actual baseline evidence: prior full-matrix run `38174442282`, shard-5 job `114574881340`, executed this same plugin suite successfully (**11 tests, 377 ms**) on the same ARM64 image and Bun revision. Local Node24 repetitions also passed, but do not reproduce the ARM64/Bun/full-shard environment. Local Bun is 1.4.0, so it supplies no matching Bun-runtime proof. The abort cause remains unresolved; baseline success or a successful retry alone cannot establish flakiness. No plugin/runtime changes or test exclusions are justified by the available evidence.

The coordinator's existing rerun of old head `f02d19bffe9cd428fe93a04b997791aa090b0902` is attempt 2 of `38187566151`; shard 3 job `114617805345` and shard 5 job `114617805483` were still running at the last pre-push check. This worker issued no CI rerun. New-head CI must pass after the durable assertion repair; parent owns its observation and final review. The separate `orca-mac-validation-go` gate remains **OPEN**.

## Genuine macOS validation proposal — attended approval required

Ordinary PR CI cannot prove a self-signed packaged helper. Before the next release claim, obtain a successful publication-disabled build of the **reviewed full PR head SHA**, with x64/Rosetta and arm64 computed-output and signature gates. If it fails, use the scoped report to identify the stage before attempting a runtime fix.

The proposed implementation is a separately reviewed manual validation wrapper plus one shared macOS packaging implementation extracted mechanically from `.github/workflows/fork-desktop-voice-release.yml:59–193`. The release caller retains its version, asset staging, uploads, updater metadata, and Linux/Windows/template requirements. A validation caller reuses the build/sign/package portion with output publication disabled. This avoids a second divergent collection of packaging gates.

Required safety contract:

1. Manual `workflow_dispatch` only, restricted to `karlorz/orca`, launched from an approved trusted workflow revision. No `pull_request_target`, automatic PR signing, secret inheritance, or untrusted fork heads.
2. Read-only `contents` permissions in every validation job. An initial secret-free job verifies an open same-repository PR targeting `fork-main`, its expected branch, full 40-character head SHA, and SHA equality with the reviewed input. Checkout that exact SHA with credentials persistence disabled; recheck `git rev-parse HEAD`. Review must include scripts and local composite actions that will receive the signing environment.
3. Explicit parent/operator approval of this SHA and the existing `ORCA_FORK_CSC_LINK` / `ORCA_FORK_CSC_KEY_PASSWORD` use. A protected environment with required reviewer can enforce this if configured; adding an unconfigured environment name supplies no approval boundary. Pass only the two existing signing secrets to the trusted packaging job.
4. Reuse `node-server-tests.yml` with `ref` equal to the verified SHA and `build_template: true`; download its exact-run `orcad-template` into `out/orcad-template`. Preserve `ORCA_REQUIRE_ORCAD_TEMPLATE=1`, both CPU variants, existing dependency actions, self-signed trust script and identity, full app/native input builds, and `macos-15` runner.
5. Packaging uses the existing config and `--mac --publish never` for x64 and arm64, `CI=true`, the existing fork build-version mechanism with a synthetic validation version only (no git tag), and `ORCA_BUILD_COMMIT` equal to the verified SHA. Validate both generated app signatures, all existing archives/manifest references and helper checks. No install or live GUI launch.
6. Validation has no release job, `contents: write`, GH release token, tag creation, marketplace/deploy commands, or desktop artifact publication. Template artifacts may be exchanged inside that one run. Preserve only public-safe check logs, exact checkout SHA, both helper success lines, and signature results as proof.

**Exact approval request:** approve a separately reviewed, trusted manual validation wrapper and shared macOS packaging extraction, then authorize one publication-disabled signing/packaging run for the reviewed full PR head SHA using the existing fork self-signed identity. This worker stops at the proposal: no workflow edits or dispatch/signing execution are performed. The parent owns that approval and the subsequent execution.

## Review and release gates

1. Parent reviewed the full audit and four code files, independently reran the verifier and diagnostic suites (19/19 passed), and authorized one diagnostic-only PR after adding the diagnostic suite to the Node runtime assignment. Ordinary CI remains a gate.
2. One normal fork PR, ordinary PR CI green, and explicit acknowledgement that the macOS cause remains unknown.
3. Genuine signed x64/Rosetta **and** arm64 packaging validation before any recovery or next-release claim. A new PR head invalidates earlier proof.
4. Parent/operator attended merge and next-free-tag gate. Existing tags stay immutable; publication and updater/assets/template decisions remain parent-owned.

No nested agents, macOS access, signing execution, workflow dispatch, live GUI, merge, tag, retag, release, publication, deployment, root operation, or upstream push was performed.
