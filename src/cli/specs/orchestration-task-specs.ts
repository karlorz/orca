import { GLOBAL_FLAGS, type CommandSpec } from '../args'

export const ORCHESTRATION_TASK_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['orchestration', 'task-create'],
    summary: 'Create an orchestration task',
    usage:
      'orca orchestration task-create --spec <text> [--task-title <text>] [--display-name <text>] [--deps <json_array>] [--parent <task_id>] [--message-id <M> --card <sha256> --intent-job <J> --intent-run <R>] [--run <run_id>] [--from <handle>] [--retry-request <id>] [--json]',
    allowedFlags: [
      ...GLOBAL_FLAGS,
      'spec',
      'task-title',
      'display-name',
      'deps',
      'parent',
      'message-id',
      'card',
      'intent-job',
      'intent-run',
      'run',
      'from',
      'retry-request'
    ],
    identityFlagRoles: { from: 'caller' },
    notes: [
      '--message-id binds one original message M to at most one Task for all time; --card, --intent-job and --intent-run are required with it.',
      '--card must be 64 lowercase hex characters. A duplicate binding fails with K_CONFLICT and creates no Task.'
    ]
  },
  {
    path: ['orchestration', 'task-list'],
    summary: 'List orchestration tasks',
    usage:
      'orca orchestration task-list [--status <status>] [--ready] [--brief] [--message-id <M>] [--card <sha256>] [--global-binding] [--run <run_id>] [--from <handle>] [--json]',
    allowedFlags: [
      ...GLOBAL_FLAGS,
      'status',
      'ready',
      'brief',
      'message-id',
      'card',
      'global-binding',
      'run',
      'from'
    ],
    identityFlagRoles: { from: 'caller' },
    notes: [
      '--brief collapses whitespace and caps each spec at 160 characters.',
      '--message-id / --card read back bindings inside the resolved Run; count 0 there is scoped absence only.',
      '--global-binding --message-id <M> is the authoritative cross-Run probe and returns {bound, task_id, binding, scope: "global"}.'
    ]
  },
  {
    path: ['orchestration', 'task-show'],
    summary: 'Show one orchestration task with its unique binding',
    usage:
      'orca orchestration task-show --id <task_id> [--run <run_id>] [--from <handle>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'id', 'run', 'from'],
    identityFlagRoles: { from: 'caller' },
    notes: ['Returns the full Task row, its binding (or null), and its binding intent rows.']
  },
  {
    path: ['orchestration', 'task-update'],
    summary: 'Update a task status',
    usage:
      'orca orchestration task-update --id <task_id> --status <status> [--result <text>] [--run <run_id>] [--from <handle>] [--retry-request <id>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'id', 'status', 'result', 'run', 'from', 'retry-request'],
    identityFlagRoles: { from: 'caller' },
    notes: [
      'Valid --status values: pending, ready, dispatched, completed, failed, blocked.',
      'To cancel a Task, stop or abandon its worker, then set --status failed --result cancelled; a later worker-start --retry-of reopens it.'
    ]
  },
]
