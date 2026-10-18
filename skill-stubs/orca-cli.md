# Orca CLI

This discovery stub loads the version-matched guide from the Orca executable used for this session.

<!-- shared: resolver -->

## Load the version-matched guide before running Orca commands

```text
ORCA skills get orca-cli
```

<!-- shared: no-guessing -->

## Verify the target before launching work

For a named repository/workspace, discover its full ID with `ORCA worktree list
--json`, inspect it with `ORCA worktree show --worktree id:<full-id> --json`, and
pass that exact selector to the launch. Check host, path, and branch (when Git).
Do not infer placement from shell cwd or absolute paths in the task prompt.
In particular, orchestration `--worktree current` means the coordinator's
recorded workspace, which can differ from `worktree current` and shell cwd.
Use exact placement when they differ; do not change caller identity to force it.
Verify the returned workspace and handle before follow-up work; the worker must
verify its own cwd/workspace before editing. A mismatch is a recovery condition,
not permission to keep working through absolute paths or launch a duplicate.
This guard also applies when an older bundled guide uses `current` examples.
Coordinator identity (`ORCA_TERMINAL_HANDLE`, `run-use`, `run-show`) lives in the
orchestration skill; load that guide before `run-create`.
