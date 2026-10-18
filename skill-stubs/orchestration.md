# Orca Orchestration

This file is a discovery stub, not the usage guide. The full, version-matched Orca
orchestration reference is served by the `orca` binary itself — kept out of this file on
purpose so it can never drift from the binary that will actually run your commands.

Engage Orca orchestration whenever you need structured multi-agent coordination: threaded
messages, blocking ask/reply flows, task dispatch, worker_done/escalation waits, task DAGs,
decision gates, coordinator loops, or decomposing work across agents. Use the orca-cli skill
instead for full ownership handoffs ("hand off", "handoff", "handover", "give this to
another agent", "another worktree") when the user did not ask to supervise, monitor, wait
for results, or coordinate a DAG — and for ordinary terminal control, shell commands,
worktree management, and the built-in browser. Coordination requires real Orca runtime
state; never substitute a non-Orca subagent tool.

<!-- shared: resolver -->

## Load the version-matched guide before running Orca commands

```text
ORCA skills get orchestration
```

That prints the compact, version-matched guide for the exact binary that will handle your
next commands. It covers the normal local coordinator loop. For a conditional action gate
such as remote placement, uncertain release recovery, or expanded DAG work, load only the
reference that gate names with
`ORCA skills get orchestration --reference references/<file>.md`
(`--references` lists the names). If that binary rejects `--reference`, run
`ORCA skills get orchestration --full` and read the named bundled reference before acting.

<!-- shared: no-guessing -->

## Verify the target before dispatch

For a named repository/workspace, discover its full ID with `ORCA worktree list
--json`, inspect it with `ORCA worktree show --worktree id:<full-id> --json`, and
pass that exact selector to `worker-start`. Check host, path, and branch (when
Git). `--worktree current` and an omitted selector mean the coordinator's recorded
workspace, not shell cwd; `worktree current` can report a different workspace.
Absolute paths in a Task spec do not select placement. Do not change caller
identity to force it. Verify the returned workspace and handle before follow-up
work, and require the worker to verify cwd/workspace before editing. On mismatch,
use lifecycle recovery and confirm the original editor has stopped before any
replacement; do not continue via absolute paths. This guard also applies when
an older bundled guide uses `current` examples.

Also verify the coordinator's own identity before `run-create` or `run-use`.
Inspect the injected session or `ORCA_TERMINAL_HANDLE` and its workspace; inherited
environment is not proof this agent owns that terminal. Run notifications follow
the coordinator binding, independently of worker placement. If it names another
live session, do not consume its inbox or impersonate it with flags/environment.
Launch a dedicated coordinator in the verified target and have it bind the Run
from its own identity; verify `run-show` before claiming routing is repaired.
