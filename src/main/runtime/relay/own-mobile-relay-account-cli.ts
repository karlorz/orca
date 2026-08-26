import process from 'node:process'
import { existsSync } from 'node:fs'
import { openOwnMobileRelaySecurityStateSqlite } from './own-mobile-relay-security-state-sqlite'
import {
  derivePasswordRecord,
  verifyPasswordRecord,
  validatePasswordCandidate,
  CURRENT_PASSWORD_POLICY,
  type PasswordPolicy
} from './own-mobile-relay-password'

export type AccountCliPromptInterface = {
  isTTY: () => boolean
  promptSecret: (promptText: string) => Promise<string>
}

export type AccountCliOptions = {
  args: string[]
  env?: Record<string, string | undefined>
  prompt?: AccountCliPromptInterface
  passwordPolicy?: PasswordPolicy
}

export type AccountCliResult = {
  exitCode: number
  stdout: string
  stderr: string
}

export const defaultConsolePrompt: AccountCliPromptInterface = {
  isTTY: () => Boolean(process.stdin.isTTY && process.stdout.isTTY),
  promptSecret: async (promptText: string): Promise<string> => {
    return new Promise((resolve, reject) => {
      const stdin = process.stdin
      const stdout = process.stdout

      if (!stdin.isTTY) {
        reject(new Error('Interactive TTY required'))
        return
      }

      const wasRaw = stdin.isRaw
      stdin.setRawMode?.(true)
      stdin.resume()
      stdin.setEncoding('utf8')

      stdout.write(promptText)

      let password = ''

      const onData = (chunk: string | Buffer): void => {
        const str = typeof chunk === 'string' ? chunk : chunk.toString('utf8')
        for (const char of str) {
          if (char === '\r' || char === '\n' || char === '\u0004') {
            cleanup()
            stdout.write('\n')
            resolve(password)
            return
          }
          if (char === '\u0003') {
            cleanup()
            stdout.write('\n')
            reject(new Error('Operation cancelled by user'))
            return
          }
          if (char === '\u0008' || char === '\u007f') {
            if (password.length > 0) {
              password = password.slice(0, -1)
            }
          } else {
            password += char
          }
        }
      }

      const cleanup = (): void => {
        stdin.removeListener('data', onData)
        stdin.setRawMode?.(wasRaw ?? false)
        stdin.pause()
      }

      stdin.on('data', onData)
    })
  }
}

export async function runAccountCli(options: AccountCliOptions): Promise<AccountCliResult> {
  const env = options.env ?? process.env
  const prompt = options.prompt ?? defaultConsolePrompt
  const policy = options.passwordPolicy ?? CURRENT_PASSWORD_POLICY

  const stdoutChunks: string[] = []
  const stderrChunks: string[] = []

  const out = (msg: string): void => {
    stdoutChunks.push(msg)
  }
  const err = (msg: string): void => {
    stderrChunks.push(msg)
  }

  // Reject secret-bearing env variables in account CLI mode
  const forbiddenEnvKeys = [
    'OWN_RELAY_OPERATOR_PASSWORD',
    'OWN_RELAY_OPERATOR_EMAIL',
    'OWN_RELAY_OPERATOR_USER_ID',
    'OWN_RELAY_OPERATOR_PROFILE_ID',
    'OWN_RELAY_OPERATOR_ORG_ID'
  ]
  for (const key of forbiddenEnvKeys) {
    if (env[key] !== undefined && env[key] !== '') {
      err(
        `[own-mobile-relay] Error: Secret environment variables not permitted for account CLI (${key}).\n`
      )
      return { exitCode: 1, stdout: stdoutChunks.join(''), stderr: stderrChunks.join('') }
    }
  }

  const [subcommand, ...restArgs] = options.args
  if (subcommand !== 'change-password' && subcommand !== 'reset-password') {
    err(
      `[own-mobile-relay] Unknown account subcommand: ${subcommand ?? ''}. Available: change-password, reset-password\n`
    )
    return { exitCode: 1, stdout: stdoutChunks.join(''), stderr: stderrChunks.join('') }
  }

  if (restArgs.length > 0) {
    err(`[own-mobile-relay] Unexpected option or argument: ${restArgs.join(' ')}\n`)
    return { exitCode: 1, stdout: stdoutChunks.join(''), stderr: stderrChunks.join('') }
  }

  const dbPath = env.OWN_RELAY_STATE_PATH
  if (!dbPath) {
    err('[own-mobile-relay] Missing required environment variable: OWN_RELAY_STATE_PATH\n')
    return { exitCode: 1, stdout: stdoutChunks.join(''), stderr: stderrChunks.join('') }
  }

  if (!existsSync(dbPath)) {
    err(`[own-mobile-relay] Database file does not exist: ${dbPath}\n`)
    return { exitCode: 1, stdout: stdoutChunks.join(''), stderr: stderrChunks.join('') }
  }

  if (!prompt.isTTY()) {
    err('[own-mobile-relay] Interactive TTY required for password commands.\n')
    return { exitCode: 1, stdout: stdoutChunks.join(''), stderr: stderrChunks.join('') }
  }

  let securityState
  try {
    securityState = openOwnMobileRelaySecurityStateSqlite({ dbPath })
  } catch (openErr) {
    err(
      `[own-mobile-relay] Failed to open database: ${openErr instanceof Error ? openErr.message : String(openErr)}\n`
    )
    return { exitCode: 1, stdout: stdoutChunks.join(''), stderr: stderrChunks.join('') }
  }

  try {
    const account = await securityState.getAccount()
    const passwordRec = await securityState.getAccountPasswordRecord()
    if (!account || !passwordRec) {
      err('[own-mobile-relay] No operator account found in database. Bootstrap account first.\n')
      return { exitCode: 1, stdout: stdoutChunks.join(''), stderr: stderrChunks.join('') }
    }

    if (subcommand === 'change-password') {
      let currentPassword = ''
      try {
        currentPassword = await prompt.promptSecret('Enter current password: ')
      } catch (promptErr) {
        err(
          `[own-mobile-relay] Prompt error: ${promptErr instanceof Error ? promptErr.message : String(promptErr)}\n`
        )
        return { exitCode: 1, stdout: stdoutChunks.join(''), stderr: stderrChunks.join('') }
      }

      const verifyResult = await verifyPasswordRecord(
        currentPassword,
        passwordRec.passwordRecord,
        policy
      )
      if (!verifyResult.valid) {
        err('[own-mobile-relay] Current password verification failed.\n')
        return { exitCode: 1, stdout: stdoutChunks.join(''), stderr: stderrChunks.join('') }
      }
    }

    let newPassword = ''
    let confirmPassword = ''
    try {
      newPassword = await prompt.promptSecret('Enter new password: ')
      confirmPassword = await prompt.promptSecret('Confirm new password: ')
    } catch (promptErr) {
      err(
        `[own-mobile-relay] Prompt error: ${promptErr instanceof Error ? promptErr.message : String(promptErr)}\n`
      )
      return { exitCode: 1, stdout: stdoutChunks.join(''), stderr: stderrChunks.join('') }
    }

    if (newPassword !== confirmPassword) {
      err('[own-mobile-relay] Passwords do not match.\n')
      return { exitCode: 1, stdout: stdoutChunks.join(''), stderr: stderrChunks.join('') }
    }

    if (!validatePasswordCandidate(newPassword)) {
      err('[own-mobile-relay] New password must be between 14 and 1024 characters.\n')
      return { exitCode: 1, stdout: stdoutChunks.join(''), stderr: stderrChunks.join('') }
    }

    const newPasswordRecord = await derivePasswordRecord(newPassword, policy)
    const replaceResult = await securityState.replacePasswordVerifier({
      expectedVerifierVersion: passwordRec.verifierVersion,
      newPasswordRecord
    })

    if (!replaceResult.ok) {
      err(`[own-mobile-relay] Failed to update password verifier: ${replaceResult.error}\n`)
      return { exitCode: 1, stdout: stdoutChunks.join(''), stderr: stderrChunks.join('') }
    }

    if (subcommand === 'change-password') {
      out(
        '[own-mobile-relay] Password changed successfully. Active desktop sessions invalidated.\n'
      )
    } else {
      out('[own-mobile-relay] Password reset successfully. Active desktop sessions invalidated.\n')
    }

    return { exitCode: 0, stdout: stdoutChunks.join(''), stderr: stderrChunks.join('') }
  } finally {
    try {
      await securityState.close()
    } catch {
      // ignore
    }
  }
}
