import type { RuntimeClient } from './runtime-client'
import { listSavedTaskReviewRows } from './tasks-review-view'
import { startTaskReview, type TaskReviewStartOptions } from './tasks-review-start'

const USAGE = [
  'Usage:',
  '  scripts/tasks-review list',
  '  scripts/tasks-review start --repo <owner/repo> --number <n> --type <pr|issue> [--repo-id <id>] [--dry-run]',
  'Build the CLI first with pnpm build:cli. Output is JSON; a partial list exits with code 2.'
].join('\n')

type Command = { kind: 'list' } | { kind: 'start'; options: TaskReviewStartOptions }

export async function runTasksReview(client: Pick<RuntimeClient, 'call'>, argv: string[]) {
  const command = parseCommand(argv)
  return command.kind === 'list'
    ? listSavedTaskReviewRows(client)
    : startTaskReview(client, command.options)
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  if (argv.length === 1 && (argv[0] === '--help' || argv[0] === '-h')) {
    process.stdout.write(`${USAGE}\n`)
    return
  }
  try {
    const { RuntimeClient } = await import('./runtime-client.js')
    const result = await runTasksReview(new RuntimeClient(), argv)
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    if ('complete' in result && !result.complete) {
      process.exitCode = 2
    }
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify({ error: error instanceof Error ? error.message : String(error) })}\n`
    )
    process.exitCode = 1
  }
}

function parseCommand(argv: string[]): Command {
  const [verb, ...rest] = argv
  if (verb === 'list') {
    if (rest.length > 0) {
      throw new Error(USAGE)
    }
    return { kind: 'list' }
  }
  if (verb !== 'start') {
    throw new Error(USAGE)
  }
  const flags = new Map<string, string | true>()
  const valued = new Set(['repo', 'repo-id', 'number', 'type'])
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index]
    if (!token.startsWith('--')) {
      throw new Error(`Unexpected argument: ${token}\n${USAGE}`)
    }
    const name = token.slice(2)
    if (flags.has(name)) {
      throw new Error(`Repeated flag: ${token}`)
    }
    if (name === 'dry-run') {
      flags.set(name, true)
      continue
    }
    if (!valued.has(name)) {
      throw new Error(`Unknown flag: ${token}`)
    }
    const value = rest[++index]
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for ${token}`)
    }
    flags.set(name, value)
  }
  const repo = flags.get('repo')
  const number = Number(flags.get('number'))
  const type = flags.get('type')
  const repoId = flags.get('repo-id')
  if (
    typeof repo !== 'string' ||
    !Number.isSafeInteger(number) ||
    number <= 0 ||
    (type !== 'pr' && type !== 'issue') ||
    (repoId !== undefined && typeof repoId !== 'string')
  ) {
    throw new Error(USAGE)
  }
  return {
    kind: 'start',
    options: {
      repo,
      number,
      type,
      ...(repoId ? { repoId } : {}),
      dryRun: flags.get('dry-run') === true
    }
  }
}
