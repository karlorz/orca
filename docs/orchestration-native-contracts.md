# Orchestration native contracts: unique bind + selective FIFO

Status: implemented on `feat/orchestration-unique-bind-20261109`, additive to the
orchestration RPC/CLI wire. Implements the PDR safe-ingress v1 native contracts in
`DESIGN.md` §4 (unique binding), §7.B (SELECTIVE_NATIVE) and §7.C (snapshot vocabulary).

Remote-wire compatibility: every response field below is additive. Older hosts omit them;
newer hosts keep every pre-existing field unchanged. Older clients that send no new flags
see no behavior change.

## 1. Unique bind (DESIGN §4)

A Task may carry one immutable binding `K = (message_id M, card_digest C, intent_job J, intent_run R)`.
At most one Task may exist per `M` for all time; the database enforces it with a partial unique
index, not a title match.

### Schema

| Object | Definition |
| --- | --- |
| `tasks.message_id` | `TEXT NULL` |
| `tasks.card_digest` | `TEXT NULL` |
| `tasks.intent_job` | `TEXT NULL` |
| `tasks.intent_run` | `TEXT NULL` |
| `tasks.binding_generation` | `INTEGER NOT NULL DEFAULT 1` |
| `idx_tasks_message_id_unique` | `UNIQUE INDEX ON tasks(message_id) WHERE message_id IS NOT NULL` |
| `task_binding_intents` | `intent_id` PK, `message_id` NOT NULL, `card_digest` NOT NULL, `intent_job`, `intent_run`, `owner_terminal_handle`, `generation` NOT NULL, `state CHECK(state IN ('"'"'reserved'"'"','"'"'committed'"'"','"'"'conflict'"'"'))` NOT NULL, `task_id`, `error`, `created_at`, `updated_at` |
| `idx_task_binding_intents_message_id` | `UNIQUE INDEX ON task_binding_intents(message_id)` |

The Task row and its `task_binding_intents` row are written in the same transaction
(`task_create_binding` savepoint inside any enclosing transaction). `state` is always
`committed` in this single-transaction implementation; `reserved` and `conflict` are reserved
for a future two-phase reservation protocol and are not emitted today.

### CLI flags: `orca orchestration task-create`

```
--message-id <M>   Original message id. Requires --card, --intent-job and --intent-run.
--card <sha256>    Exactly 64 lowercase hex characters.
--intent-job <J>   Intent job id.
--intent-run <R>   Intent run id.
```

All four are all-or-nothing. Partial or malformed bindings fail closed with `invalid_argument`
at both the zod boundary and the store. A create without any of them behaves exactly as before
(`binding` is `null`).

### Success response

```json
{
  "task": { "...": "full TaskRow" },
  "binding": {
    "message_id": "msg_...",
    "card_digest": "5ff4...",
    "intent_job": "job_...",
    "intent_run": "run_...",
    "generation": 1,
    "conflict": false,
    "task_id": "task_..."
  }
}
```

`binding` is `null` for an unbound Task.

### Duplicate create

No Task is inserted. The RPC fails with code `K_CONFLICT` and data:

```json
{
  "existing_task_id": "task_...",
  "existing": {
    "message_id": "msg_...",
    "card_digest": "5ff4...",
    "intent_job": "job_...",
    "intent_run": "run_...",
    "generation": 1
  },
  "reason": "same_message"
}
```

`reason` is `same_message` when `C/J/R` match the winner and `binding_mismatch` otherwise
(same `M`, different card or intent). `K_CONFLICT` is a structured RPC error code, preserved
through `mapRuntimeError` rather than collapsing to `runtime_error`.

### Authoritative readback: `orca orchestration task-list`

```
--message-id <M>   Filter by binding message id.
--card <sha256>    Filter by binding card digest.
```

Response adds `count` (exact cardinality of the filtered result) and a per-row `binding`
(`null` for unbound rows, otherwise the same shape as above). An empty result with `count: 0`
is the only documented safe-absence signal for `K`; title equality, a stale list, or an
error are never absence proof.

### `orca orchestration task-show --id <task_id>`

New command. Returns the full Task row, its `binding` (or `null`) and `intents` — the ordered
`task_binding_intents` rows for that Task. Unknown or cross-Run ids fail with `task_not_found`.

## 2. Mailbox fence (DESIGN §7.B/§7.C)

`runs.mailbox_fence` is a monotonically increasing integer (`INTEGER NOT NULL DEFAULT 0`).
It is bumped inside the same transaction as every mailbox mutation:

| Mutation | Site |
| --- | --- |
| Message insert | `message-insert.ts` |
| Read mark / read+delivered mark | `message-inbox.ts` |
| Delivered/undelivered stamp | `message-inbox.ts` |
| Delivery create | `role-mailbox-delivery.ts` |
| Delivery acknowledgment | `role-mailbox-delivery.ts` |
| Selective consume | `run-mailbox-selective-consume.ts` |

`orchestration check` responses (Run and worker mailboxes) add `fence`. `orchestration inbox`
adds `fence` when `--run <run_id>` scopes the response to one Run; an unscoped inbox spans
Runs and returns no single fence. `run-show` deliberately strips the internal column.

### `--expect-fence <n>`

`check --expect-fence <n>` compares the Run's current `mailbox_fence` before any routing or
consumption. On mismatch it fails with `fence_stale` and no mutation:

```json
{ "code": "fence_stale", "data": { "expected_fence": 12, "actual_fence": 13 } }
```

`--expect-fence` requires a Run-backed mailbox (bound Run or worker Dispatch). A direct
mailbox has no Run fence and rejects the flag with `invalid_argument`.

## 3. Selective consume (DESIGN §7.B SELECTIVE_NATIVE)

`orca orchestration check --selective --message-id <M>` consumes exactly one message from the
Run mailbox in one `BEGIN IMMEDIATE` transaction. It cannot be combined with `--unread`,
`--peek`, `--all`, `--ack` or `--wait`. Worker and direct mailboxes reject it with
`selective_unsupported`.

Response fields are exactly:

```json
{
  "target_accept_count": 1,
  "unrelated_mutation_count": 0,
  "before": [{ "delivery_id": "delivery_...", "message_ids": ["msg_..."], "read": [0], "acknowledged": false }],
  "after":  [{ "delivery_id": "delivery_...", "message_ids": ["msg_..."], "read": [1], "acknowledged": false }],
  "fence": 14
}
```

Snapshot vocabulary (DESIGN §7.C, exact): each entry is
`{delivery_id, message_ids[], read[], acknowledged}`. Entries cover every Delivery for the
mailbox in rowid order (including acknowledged/fenced history), followed by unread messages
not held by any Delivery in sequence order (`delivery_id: null`, `read: [0]`,
`acknowledged: false`). The just-consumed target keeps its entry so `after` differs only in
that entry's `read` flag.

### Outcomes

| Condition | Result |
| --- | --- |
| `M` is not in the unread set | `target_accept_count: 0`, `unrelated_mutation_count: 0`, `before` deep-equals `after`, fence unchanged, no write |
| `M` belongs to an outstanding Delivery | `outstanding_delivery_conflict` with `{delivery_id, message_id}`, no write, fence unchanged |
| Otherwise | exactly `M` is marked read, fence bumps once, `target_accept_count: 1`, `unrelated_mutation_count: 0` |
| Any non-target snapshot entry changed | transaction rolls back and fails `selective_consume_verification_failed` with the diff counts and snapshots |

## 4. Error codes

| Code | Meaning |
| --- | --- |
| `K_CONFLICT` | `M` already bound; data carries `existing_task_id`, `existing`, `reason` (`same_message` or `binding_mismatch`) |
| `fence_stale` | `--expect-fence` did not match the current `runs.mailbox_fence`; no effects applied |
| `outstanding_delivery_conflict` | Selective target is held by an outstanding Delivery; acknowledge the batch instead |
| `selective_unsupported` | `--selective` used on a worker/direct mailbox |
| `selective_consume_verification_failed` | Non-target mailbox state changed during selective consume; rolled back |
| `invalid_argument` | Partial/malformed binding, bad `--expect-fence`, or `--expect-fence` on a direct mailbox |
| `task_not_found` | `task-show` id is absent from the resolved Run |

## 5. Fencing and crash semantics

- A binding Task and its intent row commit or roll back together. There is no durable state
  where one exists without the other.
- A duplicate create fails before any insert; the unique index is the final authority if a
  concurrent writer wins the race, and the loser re-reads the winner to build `K_CONFLICT`.
- `mailbox_fence` rides the mutation's own transaction (savepoint when nested), so readers
  never observe a message/Delivery mutation without the matching fence bump.
- Selective consume takes the write lock up front (`BEGIN IMMEDIATE`), revalidates the
  consumer generation inside the transaction, and compares before/after snapshots before
  committing. Any verification failure rolls the whole transaction back.
- A crash before commit leaves the mailbox and fence untouched. A lost response after commit
  is recovered by re-reading the mailbox: `M` is read exactly once, and the fence shows the
  committed bump. `K` readback (`task-list --message-id`) is the recovery query for creates.

## 6. Migration notes (v43 → v44)

`SCHEMA_VERSION` is now 44. `migrateV44` is additive and idempotent:

1. `ALTER TABLE tasks ADD COLUMN` for `message_id`, `card_digest`, `intent_job`,
   `intent_run`, `binding_generation INTEGER NOT NULL DEFAULT 1` when missing.
2. `ALTER TABLE runs ADD COLUMN mailbox_fence INTEGER NOT NULL DEFAULT 0` when missing.
3. Creates `idx_tasks_message_id_unique` (partial unique index) and
   `task_binding_intents` plus its unique message index.

Fresh databases get the columns from `createTables`; the unique index is created by
`migrateV44` because an older `tasks` table lacks `message_id` when `createTables` runs.
Pre-v44 rows have `message_id IS NULL`, so they are unbound and outside the partial index.
Rollback to a v43 binary leaves the new columns/tables in place; v43 ignores them.

## 7. DESIGN mapping

| DESIGN requirement | Native path | Test |
| --- | --- | --- |
| §4 create-time embed (Task + intent, one transaction) | `src/main/runtime/orchestration/db/tasks/task-store.ts:73` (Task INSERT with binding columns), `src/main/runtime/orchestration/db/tasks/task-binding-store.ts:91` (intent INSERT), RPC `src/main/runtime/rpc/methods/orchestration/messaging/task-methods.ts:26` | `src/main/runtime/orchestration/db/task-binding.test.ts`, `src/main/runtime/rpc/methods/orchestration/runs/task-binding-rpc.test.ts` |
| §4 authoritative readback query (exact cardinality) | `src/main/runtime/orchestration/db/tasks/task-store.ts:166` (`listTasks`), `:203` (`listTasksWithDispatch`), `src/main/runtime/orchestration/db/tasks/task-binding-store.ts:67` (`getTaskByMessageId`), RPC `src/main/runtime/rpc/methods/orchestration/messaging/task-methods.ts:85` | `src/main/runtime/orchestration/db/task-binding.test.ts`, `src/main/runtime/rpc/methods/orchestration/runs/task-binding-rpc.test.ts` |
| §7.B SELECTIVE_NATIVE single-transaction consume | `src/main/runtime/orchestration/db/messages/run-mailbox-selective-consume.ts:122` (transaction), `src/main/runtime/rpc/methods/orchestration/messaging/check-run.ts:80` (branch) | `src/main/runtime/rpc/methods/orchestration/messaging/check-selective.test.ts` |
| §7.B/§7.C mailbox fence + snapshot vocabulary | `src/main/runtime/orchestration/db/runs/run-mailbox-fence.ts:6` (bump), `:12` (message-owned bump), `:28` (read), `src/main/runtime/orchestration/db/messages/run-mailbox-selective-consume.ts:34` (snapshot); bump sites `message-insert.ts:63`, `message-inbox.ts:147/162/176/209`, `role-mailbox-delivery.ts:103/168` | `src/main/runtime/rpc/methods/orchestration/messaging/check-selective.test.ts`, `src/main/runtime/orchestration/db/task-binding.test.ts` |

## 8. Verification

Unit/CLI-handler tests only; no build, live runtime, or live database contact.

```
./node_modules/.bin/vitest run --config config/vitest.config.ts \
  src/main/runtime/orchestration/db/task-binding.test.ts \
  src/main/runtime/rpc/methods/orchestration/messaging/check-selective.test.ts \
  src/main/runtime/rpc/methods/orchestration/runs/task-binding-rpc.test.ts \
  src/cli/handlers/orchestration-task-binding-cli.test.ts
```

Existing suites kept green: `db.test.ts`, `check.test.ts`, `tasks-dispatch.test.ts`,
`derived-delivery-migration.test.ts`, `index-orchestration.test.ts`, task CLI handler tests,
`orchestration-all-start-versions-migration.test.ts`, mailbox consumer fencing tests.
