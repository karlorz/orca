# Sync notes: stablyai/orca `main` into `fork-main` (2026-10-11)

Branch: `sync/upstream-2026-10-11` from `origin/fork-main` (`d8481b1c71`).
Merge: `upstream/main` @ `5c7c493042` (`git merge --no-ff`).
At launch, fork-main was 446 behind / 585 ahead of upstream/main.

karlorz/orca PR #15 (`sync/upstream-2026-10-10`) already resolved the same
fork-vs-upstream conflicts against upstream `f307391637`. This merge reused
those resolutions and then applied the remaining 46 upstream commits
(`f307391637..upstream/main`) with a 3-way merge (PR15 tree as current,
`f307391637` as base, `upstream/main` as other).

**Do not push until PR #15 is MERGED.** After it lands: `git fetch origin &&
git merge origin/fork-main`, rerun light checks, then push this branch and
open PR "sync: upstream main 2026-10-11" against `fork-main`. Do not merge it.

## Policy

- Keep fork features listed in `config/fork-features.yml`.
- Upstream wins for files the fork does not customize.
- Allowlisted auto-resolves (daily `fork-sync-fork-main.mjs`): `.gitignore`
  union; `mobile/app.json` did not conflict.

## Conflict resolutions (55 paths)

### Taken from PR #15 (inputs unchanged since that merge)

Relay/startup, automations schema/UI/CLI/RPC, dictation, pairing, i18n
fixtures, sleeping-agent launch, programmatic paste, background-session
contract, and related tests — 38 conflicted files checked out from
`origin/sync/upstream-2026-10-10`.

Deleted with upstream (same as PR #15):
`src/main/runtime/orchestration/send-agent-turn-boundary.test.ts`.

### 3-way: PR #15 + remaining upstream (`f307391637..upstream/main`)

Clean (no leftover markers):

- `cloud/apps/relay/src/relay-server.ts` — keep fork own-relay harvest bits on
  the newer upstream server.
- `mobile/pnpm-lock.yaml`
- `src/renderer/src/components/NativeChatResumeOnRestartAgentRow.tsx`
- `src/renderer/src/i18n/en-runtime-required.json`
- `src/renderer/src/i18n/locales/en.json` (fork `agentFlags` copy kept)
- `src/shared/rpc-contract/rpc-params-catalog.generated.ts`
- `src/main/startup/main-window-core-services.ts`
- `src/renderer/src/components/terminal-pane/use-terminal-pane-global-effects.ts`
- `src/renderer/src/lib/launch-agent-background-session.ts`

`.gitignore`: union of ours and theirs, then dropped two orphan comment
lines that were not ignore rules.

### Automations run-open (fork Resume + upstream paired server)

These six still conflicted in the 3-way because fork and the extra upstream
rewrote the same helpers:

- `automation-run-open-target.ts` — keep fork pane-mounted / nullable-PTY
  helpers (`selectAutomationRunPaneMounted`, `isAutomationRunPaneMounted`,
  `canOpenAutomationRunOpenTarget`) used by live view and resume-target;
  add upstream `resolveAutomationRunTerminalTarget` and
  `getAutomationRunOwnerEnvironmentId`.
- `automation-run-view-state.ts` — keep fork "leftover paneKey/ptyId is not
  a live terminal → Resume"; add upstream "terminal is on the paired
  server" View-run state. Drop upstream's leftover-identity "View run /
  unavailable" branch.
- `automation-run-workspace-action.ts` — keep fork sleeping-session remount
  for a closed tab; add upstream `openRunTerminalOnOwner` /
  `activateTerminalTabOnOwner` for a paired-server terminal.
- `use-automation-run-page-state.ts` — keep fork hook (store has no
  `unifiedTabsByWorktree` fields; `AutomationsPageSurface` does not read
  `selectedAutomationRunPageViewState`).
- `automation-run-open-target.test.ts` — keep fork cases (View run while
  the pane is mounted after the original PTY is gone).
- `src/relay/agent-exec-disposal.test.ts` — take upstream comment wrapping.

### PR #15 fork artifacts copied in

- `src/main/runtime/relay/relay-auth-coordinator-types.ts` (max-lines split)
- `src/main/startup/main-process-relay-install-retry.test.ts`
- `src/main/automations/headless-automation-agent-launch-fork-args.test.ts`
- `src/main/persistence/scheduling-automations/automation-agent-flags-migration.ts`
  (+ test)
- `src/main/ipc/orca-profile-handler-args.ts` and the extract in
  `src/main/ipc/orca-profiles.ts`
- `tests/e2e/helpers/paired-web-client-url.unit.test.ts`

Not copied: `src/relay/dispatcher-bulk-*.ts` (present on PR #15 because it
merged older upstream; deleted on current `upstream/main`).

`src/shared/terminal-navigation-runtime-capabilities.ts` was not copied.
Upstream now inlines `terminal.session-navigation.v1`,
`terminal.originating-pane-navigation.v1`, and `terminal.question-answer.v1`
in `protocol-version.ts`. Fork `automation.agent-flags.v1` lives in
`src/shared/automation-runtime-capabilities.ts` and is advertised via
`AUTOMATION_RUNTIME_CAPABILITIES`.

### Auto-merged files that still needed PR #15 semantics

- `pet.speak` and fork terminal navigation/question RPC methods: restore
  `permission: 'workspace'` (required by upstream's RPC define helpers).
- `loaded-state-parsing.ts`: wire `migrateLegacyAutomationAgentFlags` after
  context backfill, before owner migration.
- `AutomationEditorSettingsSidebar.test.tsx`: restore fork `model` /
  `agentFlags` fixture fields.

## Follow-up after the merge commit

Git auto-merged fork-only `automation-model.ts` and launch/CLI helpers from
`origin/fork-main`, which still used the pre-rename `extraArgs` names. Restored
the PR #15 `agentFlags` versions in `d284965952` so they match the
conflict-resolved `automation-params` types.

## Light local checks (this box, via `heavy-run`)

- `tsc --noEmit -p config/tsconfig.tc.cli.json`: clean.
- vitest `--maxWorkers=1` on 12 related files (agentFlags, run-open-target,
  editor sidebar, relay-auth-coordinator, relay install retry, desktop
  installer, session broker, schedule picker, agent-exec-disposal): 104
  passed.
- Full `pnpm tc` (node+web, 7+6 GiB heaps) and mobile tests not run locally.
  Native `node-pty` rebuild skipped (no `c++` on this image); install used
  `--ignore-scripts`.
- Push is blocked until PR #15 is `MERGED`.
