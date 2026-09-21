# Automations

An automation is a scheduled Orca prompt run by a chosen provider against either a repo-created worktree or an existing workspace.

```text
ORCA automations list --json
ORCA automations show <automationId> --json
ORCA automations create --name "Daily review" --trigger daily --time 09:00 --prompt "Review open changes" --provider codex --repo id:<repoId> --json
ORCA automations create --name "Weekday triage" --trigger "0 9 * * 1-5" --prompt "Triage issues" --provider claude --repo path:/abs/repo --disabled --json
ORCA automations create --name "Inbox digest" --trigger hourly --prompt "Summarize unread mail" --provider codex --workspace active --reuse-session --json
ORCA automations create --name "Grok sweep" --trigger daily --prompt "Triage alerts" --provider grok --model grok-4.5 --repo id:<repoId> --json
ORCA automations edit <automationId> --trigger weekdays --time 09:30 --fresh-session --json
ORCA automations edit <automationId> --model grok-4.5 --json
ORCA automations run <automationId> --json
ORCA automations runs --id <automationId> --json
ORCA automations remove <automationId> --json
```

Schedules accept `hourly`, `daily`, `weekdays`, `weekly`, 5-field cron, or RRULE. Use `--time <HH:MM>` with `daily`/`weekdays`/`weekly`, and `--day <0-6>` only with `weekly` where Sunday is `0`.

Use `--model <id>` to launch the run with a specific model. The id is free-form (models come from your own agent config) and Orca only emits a model flag for providers whose flag it knows, so an unset or unsupported-combination value simply keeps the agent's configured default. On `edit`, pass `--model ""` to clear a saved model. Use `--reasoning-effort <low|medium|high|xhigh>` to set the model's reasoning ladder; omit it for the agent default, or pass an empty value on `edit` to clear it. Other values, including `max`, are rejected.

Use `--repo <selector>` for a new worktree per run, or `--workspace <selector>` / `--workspace-mode existing` for an existing Orca worktree. `--repo` and `--workspace` are mutually exclusive. Use `--reuse-session` only for existing-workspace automations; if the previous terminal is gone, Orca falls back to a fresh session. Prefer `--disabled` while testing setup.
