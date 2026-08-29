# Design System

## Fork Release Rules

This is `karlorz/orca`, a fork of `stablyai/orca`. Follow these rules for all fork releases:

0. **Branches.** Default and working branch is `fork-main`. GitHub `main` is a disposable mirror of `stablyai/orca` `main`, refreshed by `.github/workflows/fork-sync-main.yml` via `merge-upstream` (`branch=main` only; needs `FORK_SYNC_TOKEN` with `repo` + `workflow`). The same workflow then merges `stablyai/orca` `main` into `fork-main` with `git merge --no-ff` (`config/scripts/fork-sync-fork-main.mjs`; auto-resolves only `mobile/app.json` version conflicts), mirrors upstream `v*` tags into the fork (`config/scripts/fork-sync-upstream-tags.mjs`), auto-cuts `v<base>-0` on new upstream desktop bases (`config/scripts/fork-next-desktop-tag.mjs --auto`), and auto-cuts `mobile-android-v<train>-0` on a new **published** mobile train (`config/scripts/fork-next-mobile-tag.mjs --auto`, bumps `app.json` first). Daily 01:17 UTC (09:17 HKT) + `workflow_dispatch`. Never use GitHub **Sync fork**. Never call `merge-upstream` on `fork-main`. Never commit product work on `main`. Record each landed fork feat in `config/fork-features.yml`. Trains are published GitHub releases, not `main` `app.json`.
1. **Two trains, like upstream.** Desktop is `release-cut` / `v1.4.x`. Mobile Android is `mobile-android-v*`. Never put macOS DMG/ZIP on a mobile tag.
2. **Keep fork mobile marketing version equal to the current published upstream mobile train.** Train = newest `stablyai/orca` release tag matching `mobile-android-vX.Y.Z` exactly, not `main` `app.json` (today: `0.0.46`; `main` `0.0.47` / `versionCode` 15 is ignored). Sync auto-resolves `mobile/app.json` to that train + `max(fork,upstream) versionCode`, then auto-cuts `mobile-android-v<train>-0` when the fork has no suffix on that base. Extra `-1`/`-2` stay attended: `node config/scripts/fork-next-mobile-tag.mjs --write`. Never rewind Play `versionCode`.
3. **Fork mobile tags:** `mobile-android-v<published-train>-N` (train `0.0.46` → auto `-0`, then attended `-1`). Never `fork-voice-v*`, never `-karlorz.N`.
3b. **Fork desktop tags:** `v1.4.190-0`, `v1.4.190-1`, … from `fork-main`. Base = newest upstream desktop tag (release candidates count; drop `-rc.N`). Never a bare `v1.4.x` without suffix. Self-signed macOS (not notarized) via `fork-desktop-voice-release.yml` and secrets `ORCA_FORK_CSC_LINK` / `ORCA_FORK_CSC_KEY_PASSWORD`. Never rewrite a published tag. Never put DMG/ZIP on a mobile tag. Fork desktop builds (`X.Y.Z-N`) resolve update feeds against `karlorz/orca` prereleases. Ad-hoc installs cannot auto-update onto the first self-signed cut.
4. **Never rewrite a published tag.** If CI fails or you need changes, use a new suffix (`-1`, `-2`, …).
5. **Push only to fork remote.** Never push tags, commits, or branches to `stablyai/orca` (upstream). Only push to `fork` (`https://github.com/karlorz/orca.git`).
6. **CI publishes as prerelease, not draft.** `--draft --prerelease`, verify assets, then `gh release edit --draft=false --prerelease --latest=false`. Operator switches Latest in the GitHub UI (uncheck Pre-release first).
7. **Fence the copied upstream mobile workflow** with `if: github.repository == 'stablyai/orca'` so `mobile-android-v0.0.44-0` does not run it on this fork.
8. **No GitHub issues/PRs upstream.** Issues and PRs only against `github.com/karlorz/*` repos.
9. **Sync `upstream/main` only after a launchable APK exists** for the current mobile line. Do not tag a merge that has not opened on the phone.

All UI work — layout, color, typography, spacing, component selection, UX behavior — must follow [`docs/STYLEGUIDE.md`](./docs/STYLEGUIDE.md). Use the tokens defined in `src/renderer/src/assets/main.css` (the canonical source) and the shadcn primitives in `src/renderer/src/components/ui/`. Don't invent new color values, font sizes, or shadow tiers when a documented one already covers the role. When STYLEGUIDE.md is silent, follow the resolution order in its final section.

## Electron UI Validation

Use the `$electron` skill and Playwright CDP for rendered Orca UI checks. Do not use computer-use for Orca UI validation.

# Style

## Reuse Before Reimplementing

Before writing new logic at any scale — a function, component, IPC channel, state store, or whole subsystem/flow — check whether an existing implementation already does the job (or nearly does). Extend or generalize it instead of building a parallel version; only write from scratch when nothing fits. Keep the check proportionate: a quick search for trivial code, a real one before building anything substantial.

## Concise/Brief Non-obvious Comments ONLY

- DO NOT: be verbose, explain the obvious, walk through the code ("WHY not HOW")
- BE CONCISE. 1 LINE if possible

## Lint Rules: Do Not Disable Max Lines

NEVER add a `max-lines` disable (`eslint-disable max-lines`, `oxlint-disable max-lines`, or line-specific variants), and never add a per-file `max-lines` bump in `mobile/.oxlintrc.json`.

## File and Module Naming

Never use vague names like `helpers`, `utils`, `common`, `misc`, or `shared-stuff` for files, folders, or modules. They carry zero info and tend to become dumping grounds. Name files after what they _actually_ contain — prefer the concrete domain concept (e.g. `tab-group-state.ts`, `terminal-orphan-cleanup.ts`) over the generic role (`tabs-helpers.ts`, `terminal-utils.ts`). If you find yourself reaching for `helpers`, the file probably has more than one responsibility and should be split, or there's a better name hiding in the code that describes what the functions operate on.

## Type Declarations: Prefer `.ts` Over `.d.ts`

# Verifying Changes

- **Typecheck**: `pnpm tc` (or `tc:node` / `tc:cli` / `tc:web`)
- **Test**: `pnpm test [path/to/file.test.ts]`
- **Lint**: `oxlint`, or `pnpm run check:code-quality:changed` for changed files (full `pnpm lint` is slow); format with `pnpm format`

# Considerations

## Worktree Safety

Always use the primary working directory (the worktree) for all file reads and edits. Never follow absolute paths from subagent results that point to the main repo.

## Cross-Platform Support

Orca targets macOS, Linux, and Windows. Keep all platform-dependent behavior behind runtime checks:

- **Keyboard shortcuts**: Never hardcode `e.metaKey`. Use a platform check (`navigator.userAgent.includes('Mac')`) to pick `metaKey` on Mac and `ctrlKey` on Linux/Windows. Electron menu accelerators should use `CmdOrCtrl`.
- **Shortcut labels in UI**: Display `⌘` / `⇧` on Mac and `Ctrl+` / `Shift+` on other platforms.
- **File paths**: Use `path.join` or Electron/Node path utilities — never assume `/` or `\`.
- **Windows setup scripts**: the setup/issue-command runner is a `.cmd` batch file unless the script starts with a `#!` line — never derive that from the user's terminal-shell preference, and never launch a `.cmd` runner with a bare `cmd.exe /c` from a Git Bash pane (MSYS rewrites the `/c`). See [`docs/reference/windows-setup-shell.md`](./docs/reference/windows-setup-shell.md).
- **Windows child processes**: start them through `runProcess`/`spawnProcess` in `src/shared/child-process/` — never `child_process` directly. It pins `windowsHide`, refuses `shell: true`, and encodes `.cmd`/`.bat` arguments so neither `CommandLineToArgvW` nor `cmd.exe` mangles them. A ratchet test fails on any new direct import.
- **Windows process enumeration**: read the table through `src/main/windows/windows-process-table.ts`, never by forking `powershell.exe`. See [`docs/reference/windows-process-enumeration.md`](./docs/reference/windows-process-enumeration.md).
- **WSL commands**: build argv with `buildWslExecArgs` (always `--exec` — under `--`, `wsl.exe` expands `$name` in every argument and silently rewrites the script), and fence anything whose stdout you parse with `buildWslCapturedLoginShellCommand`, because the interactive login shell prints the distro banner to stdout. See [`docs/reference/wsl-command-execution.md`](./docs/reference/wsl-command-execution.md).
- **Linux native modules**: keep the glibc floor at Ubuntu 20.04 / glibc 2.31. A module compiled from source on a newer runner can reference symbol versions absent on the floor and crash the app on startup. See [`docs/reference/linux-glibc-compatibility.md`](./docs/reference/linux-glibc-compatibility.md); packaging fails if a bundled native binary needs newer glibc.

## SSH Use Case

All changes must consider the SSH use case. Don't assume local-only execution. Before changing anything that reports on, stops, or lists remote work, follow [`docs/reference/ssh-execution-boundary.md`](./docs/reference/ssh-execution-boundary.md): the execution host owns everything that touches execution, and loss of contact is never evidence of process death — the verdict vocabulary is `live` / `unverifiable` / `exited`, with no synonyms.

## Folder Workspace Use Case

All changes must consider folder workspaces as well as git worktrees. Don't assume every workspace is a git worktree.

## Remote Wire Compatibility

Clients and remote Orca servers update independently, so mixed versions are the normal state. Before changing anything a paired client and host exchange — RPC params, stream frames, or the content either side publishes over them — follow [`docs/reference/remote-wire-compatibility.md`](./docs/reference/remote-wire-compatibility.md). A new optional field is safe; a new stream opcode must be capability-negotiated because decoders drop unknown opcodes silently; and changing what the host publishes reaches old clients even with no wire change.

## Git Binary Compatibility

Orca runs the user's Git binary on native, WSL, and SSH hosts, which may all have different versions. Treat Git 2.25 as the core-workflow baseline and follow [`docs/reference/git-compatibility.md`](./docs/reference/git-compatibility.md).

When adding or changing a Git command:

- Check when every subcommand and option was introduced. For newer behavior, keep a baseline-compatible fallback or degrade safely.
- Use `GitCapabilityCache` with a narrow unsupported-error predicate so recurring operations do not retry a known-invalid command. Do not rely only on `git --version`; wrappers such as `simple-git` do not remove host-version differences.
- Scope capability state to the host that executes Git: native, WSL distro, SSH provider, or relay connection. Cover the first fallback, later cached calls, concurrent probes, and relevant host isolation in tests.
- Keep the real-binary compatibility contract in PR CI current. When adopting a newer Git feature, add its version boundary so the preferred command and fallback both run against representative Git releases.
- Preserve commands that begin with global Git options such as `-c` before the subcommand, including auto-maintenance suppression used by worktree-create fetches.

## Git Provider Compatibility

Source-control and review changes must consider GitLab and other supported git providers, not only GitHub. Keep provider-specific behavior behind explicit checks, and avoid GitHub-only naming for generic review concepts.

## GitHub CLI Usage

Be mindful of the user's `gh` CLI API rate limit — batch requests where possible and avoid unnecessary calls. All code, commands, and scripts must be compatible with macOS, Linux, and Windows.
