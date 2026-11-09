# Orchestration native contracts: unique bind + selective FIFO

Status: revision 2 on `feat/orchestration-unique-bind-20261109`, additive to the
orchestration RPC/CLI wire. Implements the PDR safe-ingress v1 native contracts in
`DESIGN.md` §4 (unique binding), §7.B (SELECTIVE_NATIVE) and §7.C (snapshot vocabulary).

Remote-wire compatibility: every response field below is additive. Older hosts omit them;
newer hosts keep every pre-existing field unchanged. Older clients that send no new flags
see no behavior change.

## 1. Unique bind (DESIGN §4)

A Task may carry one immutable binding `K = (message_id M, card_digest C, intent_job J, intent_run R)`.
At most one Task may exist per identity for all time; the database enforces this with three
partial unique indexes, not a title match.

### Identity namespace (normative)

Binding identities are **global to the orchestration graph database**, not per Run:

- First write wins. A conflict never remaps, adopts, or rebinds the existing Task.
- `message_id` `M` is the original message identity.
- `card_digest` `C` is the exact 64-hex sha256 card identity.
- `intent_job` `J` is the fully-qualified intent-job identity string. Callers namespace it
  themselves (for example `job:run-scoped-slug`); Orca compares it verbatim, globally.
- `intent_run` `R` is part of the binding payload and is compared for conflict classification,
  but it is not itself a uniqueness key.
- A changed `M`, `C`, or `J` that collides with any existing binding is `K_CONFLICT`; the
  second write creates no Task and no intent row.

### Schema

| Object | Definition |
| --- | --- |
| `tasks.message_id` | `TEXT NULL` |
| `tasks.card_digest` | `TEXT NULL` |
| `tasks.intent_job` | `TEXT NULL` |
| `tasks.intent_run` | `TEXT NULL` |
| `tasks.binding_generation` | `INTEGER NOT NULL DEFAULT 1` |
| `idx_tasks_message_id_unique` | `UNIQUE INDEX ON tasks(message_id) WHERE message_id IS NOT NULL` |
| `idx_tasks_card_digest_unique` | `UNIQUE INDEX ON tasks(card_digest) WHERE card_digest IS NOT NULL` |
| `idx_tasks_intent_job_unique` | `UNIQUE INDEX ON tasks(intent_job) WHERE intent_job IS NOT NULL` |
| `task_binding_intents` | `intent_id` PK, `message_id` NOT NULL, `card_digest` NOT NULL, `intent_job`, `intent_run`, `owner_terminal_handle`, `generation` NOT NULL, `state CHECK(state IN ('reserved','committed','conflict'))` NOT NULL, `task_id`, `error`, `created_at`, `updated_at` |
| `idx_task_binding_intents_message_id` | `UNIQUE INDEX ON task_binding_intents(message_id)` |

The Task row and its `task_binding_intents` row are written in the same transaction
(`task_create_binding` savepoint inside any enclosing transaction). `state` is always
`committed` in this single-transaction implementation; `reserved` and `conflict` are reserved
for a future two-phase reservation protocol and are not emitted today. The intent table keeps
its own `message_id` uniqueness; task-level `M/C/J` indexes are the durable boundary because
the intent row commits atomically with the Task it names. A separate intent-side `C`/`J` index
would duplicate the same transaction's authority without adding a new failure mode.

### CLI flags: `orca orchestration task-create`

```
--message-id <M>   Original message id. Requires --card, --intent-job and --intent-run.
--card <sha256>    Exactly 64 lowercase hex characters.
--intent-job <J>   Fully-qualified intent-job identity string.
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
    "intent_job": "job:...",
    "intent_run": "run_...",
    "generation": 1,
    "conflict": false,
    "task_id": "task_..."
  }
}
```

`binding` is `null` for an unbound Task.

### Duplicate or conflicting create

No Task is inserted. The RPC fails with code `K_CONFLICT` and data:

```json
{
  "existing_task_id": "task_...",
  "existing": {
    "message_id": "msg_...",
    "card_digest": "5ff4...",
    "intent_job": "job:...",
    "intent_run": "run_...",
    "generation": 1
  },
  "reason": "same_message"
}
```

`reason` is `same_message` only when `M/C/J/R` all match the winner. Every other collision —
same `M` with changed `C/J/R`, same `C` under a different `M/J`, same `J` under a different
`M/C/R`, or a cross-Run rebinding — is `binding_mismatch`. The winner fields use the same
disclosure posture for every collision class. `K_CONFLICT` is a structured RPC error code,
preserved through `mapRuntimeError` rather than collapsing to `runtime_error`.

Conflict detection order inside the create transaction is `M`, then `C`, then `J`. If a
unique index fires anyway (cross-connection race), the loser re-reads the same order and
returns the winner. If that winner cannot be read, the create fails closed with
`existing_task_id: null`, `existing: null`, `reason: "binding_mismatch"`; it never reports
success or absence.

### Scoped readback: `orca orchestration task-list`

```
--message-id <M>   Filter by binding message id inside the resolved Run.
--card <sha256>    Filter by binding card digest inside the resolved Run.
```

Response adds `scope: "run-filtered"`, `count` (exact cardinality of the filtered result),
`global_binding_exists` (a boolean when `--message-id` is supplied, otherwise `null`; it is a
bare existence bit with no winner details), and a per-row `binding` (`null` for unbound rows,
otherwise the same shape as above).

### Global binding probe: `orca orchestration task-list --message-id <M> --global-binding`

The authoritative M lookup. It ignores Run scoping and returns exactly:

```json
{ "scope": "global", "bound": true, "task_id": "task_...", "binding": { "...": "..." } }
```

A miss returns `{ "scope": "global", "bound": false, "task_id": null, "binding": null }`.
`--global-binding` requires `--message-id` and cannot be combined with `--card`, `--status`,
`--ready`, or `--brief`. It uses the same `workspace` RPC permission class as `task-show`, so
winner disclosure is limited to callers already allowed to read the full Task. Errors fail
closed; a failed probe is never absence.

### Safe absence (normative)

- `count: 0` from `task-list` with a Run, card, status, or ready filter is **scoped absence**.
  It never authorizes another write and never proves that `M` is unbound.
- Only the global probe (`--global-binding`) or the create-time `K_CONFLICT` path is
  authoritative for `M`.
- Recovery: a wrong-Run or wrong-card zero must be re-checked with the global probe. A
  status-filtered zero must be re-read without the status filter (or with the global probe).
  If the probe is `bound: true`, reconcile with the winner; do not create, retry, or rebind.
- Title equality, a stale list, a scoped zero, or an RPC error are never absence proof.

### `orca orchestration task-show --id <task_id>`

Returns the full Task row, its `binding` (or `null`) and `intents` — the ordered
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
| Selective consume (only when the target actually transitions unread → read) | `run-mailbox-selective-consume.ts` |

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

### Target resolution

Inside the transaction the target is resolved from the live message row, not from historical
snapshot membership:

- The row must exist in this exact Run mailbox (`run_id`, `to_handle = run:<id>`,
  `delivery_contract = 'current_delivery'`) and must currently have `read = 0`.
- An already-read target — standalone read mail, acknowledged history, fenced history, or a
  read target with duplicate historical memberships — is a no-op. No write, no fence bump,
  and `before`/`after` are identical.
- An unread target held by an outstanding Delivery is refused with
  `outstanding_delivery_conflict` exactly as before. Fenced history does not refuse an unread
  target.
- Acceptance is reported only after observing the actual `0 → 1` read transition; otherwise
  the transaction rolls back with `selective_consume_verification_failed`.

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
`acknowledged: false`). The just-consumed target keeps its entry so `after` differs only at
the target's positions: only target indices may move `0 -> 1`, while every other
`(message_id, read)` position in the same Delivery and each entry's `delivery_id`,
`message_ids` order and `acknowledged` flag must compare equal.

### Outcomes

| Condition | Result |
| --- | --- |
| `M` is absent, outside this Run mailbox, or currently read (standalone, acknowledged, fenced, duplicate history) | `target_accept_count: 0`, `unrelated_mutation_count: 0`, `before` deep-equals `after`, fence unchanged, no write |
| Unread `M` belongs to an outstanding Delivery | `outstanding_delivery_conflict` with `{delivery_id, message_id}`, no write, fence unchanged |
| Unread `M` in no outstanding Delivery | exactly `M` is marked read, fence bumps once, `target_accept_count: 1`, `unrelated_mutation_count: 0` |
| Target read transition not observed, or any peer read flag, Delivery metadata, or non-target snapshot entry changed | transaction rolls back and fails `selective_consume_verification_failed` with the diff counts and snapshots |

## 4. Error codes

| Code | Meaning |
| --- | --- |
| `K_CONFLICT` | `M`, `C`, or `J` already bound; data carries `existing_task_id`, `existing`, `reason` (`same_message` or `binding_mismatch`) |
| `fence_stale` | `--expect-fence` did not match the current `runs.mailbox_fence`; no effects applied |
| `outstanding_delivery_conflict` | Selective target is held by an outstanding Delivery; acknowledge the batch instead |
| `selective_unsupported` | `--selective` used on a worker/direct mailbox |
| `selective_consume_verification_failed` | Target transition or non-target mailbox state failed verification; rolled back |
| `invalid_argument` | Partial/malformed binding, bad `--expect-fence`, `--expect-fence` on a direct mailbox, or ambiguous `--global-binding` filters |
| `task_not_found` | `task-show` id is absent from the resolved Run |

## 5. Fencing and crash semantics

- A binding Task and its intent row commit or roll back together. There is no durable state
  where one exists without the other.
- A conflicting create fails before any insert. The unique indexes are the final authority if
  a concurrent writer wins the race; the loser re-reads the winner (M → C → J) to build
  `K_CONFLICT`. A winner that cannot be read fails closed; it is never reported as absence.
- `mailbox_fence` rides the mutation's own transaction (savepoint when nested), so readers
  never observe a message/Delivery mutation without the matching fence bump. Selective consume
  bumps it only on an actual target transition.
- Selective consume takes the write lock up front (`BEGIN IMMEDIATE`), revalidates the
  consumer generation inside the transaction, resolves the live unread target, and compares
  before/after snapshots before committing. Any verification failure rolls the whole
  transaction back.
- A crash before commit leaves the mailbox and fence untouched. A lost response after commit
  is recovered by re-reading the mailbox: `M` is read exactly once, and the fence shows the
  committed bump. A repeated selective consume for an already-read target is a no-op with the
  same fence, so recovery cannot double-count acceptance.
- `K` recovery: scoped `task-list` zeros are not absence. Use the global probe or reconcile
  the create-time `K_CONFLICT`.

## 6. Migration notes

### v43 → v44

`migrateV44` is additive and idempotent:

1. `ALTER TABLE tasks ADD COLUMN` for `message_id`, `card_digest`, `intent_job`,
   `intent_run`, `binding_generation INTEGER NOT NULL DEFAULT 1` when missing.
2. `ALTER TABLE runs ADD COLUMN mailbox_fence INTEGER NOT NULL DEFAULT 0` when missing.
3. Creates `idx_tasks_message_id_unique` (partial unique index) and
   `task_binding_intents` plus its unique message index.

Fresh databases get the columns from `createTables`; the unique index is created by
`migrateV44` because an older `tasks` table lacks `message_id` when `createTables` runs.
Pre-v44 rows have `message_id IS NULL`, so they are unbound and outside the partial index.
Rollback to a v43 binary leaves the new columns/tables in place; v43 ignores them.

### v44 → v45

`SCHEMA_VERSION` is now 45; `migrateV44` is untouched for audit. `migrateV45`:

1. Verifies no v44 database already holds duplicate `card_digest` or `intent_job` identities.
   Duplicates from the pre-fix v44 build fail closed with a precise error naming the duplicate
   key; this migration never remaps, clears, or rebinds a Task.
2. Creates `idx_tasks_card_digest_unique` and `idx_tasks_intent_job_unique` (partial unique
   indexes, `WHERE ... IS NOT NULL`).

Fresh databases create the same indexes after `createTables` when the binding columns exist
(`createTaskBindingIndexesIfPossible`); pre-v44 databases skip that step and get the indexes
from `migrateV45` after v44 adds the columns. `task_binding_intents` keeps only its message
uniqueness: it is written in the same transaction as the Task, so task-level `M/C/J` indexes
are the durable boundary.

## 7. DESIGN mapping

| DESIGN requirement | Native path | Test |
| --- | --- | --- |
| §4 create-time embed (Task + intent, one transaction) | `src/main/runtime/orchestration/db/tasks/task-store.ts:74` (Task INSERT with binding columns), `src/main/runtime/orchestration/db/tasks/task-binding-store.ts:134` (intent INSERT), RPC `src/main/runtime/rpc/methods/orchestration/messaging/task-methods.ts:26` | `src/main/runtime/orchestration/db/task-binding.test.ts`, `src/main/runtime/rpc/methods/orchestration/runs/task-binding-rpc.test.ts` |
| §4 global M/C/J conflict boundary | `src/main/runtime/orchestration/db/tasks/task-binding-store.ts:105` (`findTaskBindingConflict`), `:80` (M), `:86` (C), `:95` (J), `src/main/runtime/orchestration/db/schema/migrate-v45.ts:6` (indexes), `src/main/runtime/orchestration/db/schema/create-graph-tables-sql.ts:10` | `src/main/runtime/orchestration/db/task-binding.test.ts`, `src/main/runtime/orchestration/db/schema/migrate-v45.test.ts` |
| §4 authoritative readback query (exact cardinality) | `src/main/runtime/orchestration/db/tasks/task-store.ts:167` (`listTasks`), `:204` (`listTasksWithDispatch`), RPC `src/main/runtime/rpc/methods/orchestration/messaging/task-methods.ts:85` | `src/main/runtime/orchestration/db/task-binding.test.ts`, `src/main/runtime/rpc/methods/orchestration/runs/task-binding-rpc.test.ts` |
| §4 global M probe with explicit scope | `src/main/runtime/rpc/methods/orchestration/messaging/task-methods.ts:93` (`globalBinding` branch, `scope: 'global'` at `:96`), `:133` (`scope: 'run-filtered'`, `global_binding_exists`) | `src/main/runtime/rpc/methods/orchestration/runs/task-binding-rpc.test.ts`, `src/cli/handlers/orchestration-task-binding-cli.test.ts` |
| §7.B SELECTIVE_NATIVE single-transaction consume | `src/main/runtime/orchestration/db/messages/run-mailbox-selective-consume.ts:137` (transaction, `BEGIN IMMEDIATE` at `:142`), unread target resolution at `:104`/`:151`, branch `src/main/runtime/rpc/methods/orchestration/messaging/check-run.ts:80` | `src/main/runtime/rpc/methods/orchestration/messaging/check-selective.test.ts` |
| §7.B/§7.C mailbox fence + snapshot vocabulary | `src/main/runtime/orchestration/db/runs/run-mailbox-fence.ts:6` (bump), `:12` (message-owned bump), `:28` (read), `src/main/runtime/orchestration/db/messages/run-mailbox-selective-consume.ts:34` (snapshot); bump sites `message-insert.ts:63`, `message-inbox.ts:147/162/176/209`, `role-mailbox-delivery.ts:103/168` | `src/main/runtime/rpc/methods/orchestration/messaging/check-selective.test.ts`, `src/main/runtime/orchestration/db/task-binding.test.ts` |

## 8. Verification

Unit/CLI-handler tests only; no build, live runtime, or live database contact.

```
./node_modules/.bin/vitest run --config config/vitest.config.ts \
  src/main/runtime/orchestration/db/task-binding.test.ts \
  src/main/runtime/orchestration/db/schema/migrate-v45.test.ts \
  src/main/runtime/rpc/methods/orchestration/messaging/check-selective.test.ts \
  src/main/runtime/rpc/methods/orchestration/runs/task-binding-rpc.test.ts \
  src/cli/handlers/orchestration-task-binding-cli.test.ts
```

Existing suites kept green: `db.test.ts`, `check.test.ts`, `tasks-dispatch.test.ts`,
`derived-delivery-migration.test.ts`, `index-orchestration.test.ts`, task CLI handler tests,
`orchestration-all-start-versions-migration.test.ts`, mailbox consumer fencing tests.
