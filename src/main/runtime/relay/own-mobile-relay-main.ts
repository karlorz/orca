import process from 'node:process'
import { openOwnMobileRelaySecurityStateSqlite } from './own-mobile-relay-security-state-sqlite'
import { bootstrapOperatorAccount } from './own-mobile-relay-account'
import { CURRENT_PASSWORD_POLICY, type PasswordPolicy } from './own-mobile-relay-password'
import type { AuthThrottle } from './own-mobile-relay-auth-throttle'
import { runAccountCli } from './own-mobile-relay-account-cli'
import { listenOwnMobileRelay } from './own-mobile-relay-http'

export type OwnRelayServeConfig = {
  statePath: string
  origin: string
  authOrigin: string
  clientId: string
  listenHost: string
  listenPort: number
  operator?: {
    email?: string
    password?: string
    userId?: string
    profileId?: string
    organizationId?: string
  }
}

export type OwnRelayServerInstance = {
  origin: string
  boundPort: number
  close: () => Promise<void>
}

export function checkRuntimeRequirements(nodeVersion = process.versions.node): void {
  const major = Number.parseInt(nodeVersion.split('.')[0] ?? '0', 10)
  if (Number.isNaN(major) || major < 22) {
    throw new Error(`Node.js 22 or later is required (current version: ${nodeVersion})`)
  }
}

export function parseOwnRelayServeConfig(
  env: Record<string, string | undefined> = process.env
): OwnRelayServeConfig {
  const statePath = env.OWN_RELAY_STATE_PATH
  if (!statePath) {
    throw new Error('Missing required environment variable: OWN_RELAY_STATE_PATH')
  }

  const origin = env.OWN_RELAY_ORIGIN
  if (!origin) {
    throw new Error('Missing required environment variable: OWN_RELAY_ORIGIN')
  }

  const authOrigin = env.OWN_RELAY_AUTH_ORIGIN
  if (!authOrigin) {
    throw new Error('Missing required environment variable: OWN_RELAY_AUTH_ORIGIN')
  }

  const clientId = env.OWN_RELAY_CLIENT_ID
  if (!clientId) {
    throw new Error('Missing required environment variable: OWN_RELAY_CLIENT_ID')
  }

  const listenHost = env.OWN_RELAY_LISTEN_HOST || '127.0.0.1'
  let listenPort = 8093
  if (env.OWN_RELAY_LISTEN_PORT !== undefined && env.OWN_RELAY_LISTEN_PORT !== '') {
    const parsedPort = Number.parseInt(env.OWN_RELAY_LISTEN_PORT, 10)
    if (Number.isNaN(parsedPort) || parsedPort < 0 || parsedPort > 65535) {
      throw new Error(`Invalid OWN_RELAY_LISTEN_PORT: ${env.OWN_RELAY_LISTEN_PORT}`)
    }
    listenPort = parsedPort
  }

  const email = env.OWN_RELAY_OPERATOR_EMAIL
  const password = env.OWN_RELAY_OPERATOR_PASSWORD
  const userId = env.OWN_RELAY_OPERATOR_USER_ID
  const profileId = env.OWN_RELAY_OPERATOR_PROFILE_ID
  const organizationId = env.OWN_RELAY_OPERATOR_ORG_ID ?? ''

  const bootstrapProvided = Boolean(
    email || password || userId || profileId || env.OWN_RELAY_OPERATOR_ORG_ID
  )

  let operator: OwnRelayServeConfig['operator'] | undefined

  if (bootstrapProvided) {
    operator = {
      email,
      password,
      userId,
      profileId,
      organizationId
    }
  }

  return {
    statePath,
    origin,
    authOrigin,
    clientId,
    listenHost,
    listenPort,
    operator
  }
}

export async function startOwnRelayServer(options: {
  config: OwnRelayServeConfig
  passwordPolicy?: PasswordPolicy
  silenceLimitMs?: number
  throttle?: AuthThrottle
}): Promise<OwnRelayServerInstance> {
  const { config } = options
  const passwordPolicy = options.passwordPolicy ?? CURRENT_PASSWORD_POLICY

  // 1. Open SQLite database & apply migrations
  const securityState = openOwnMobileRelaySecurityStateSqlite({
    dbPath: config.statePath
  })

  try {
    const existingAccount = await securityState.getAccount()

    // 2. Validate bootstrap rules
    if (existingAccount) {
      if (config.operator) {
        throw new Error('bootstrap_already_complete: operator account already exists in database')
      }
    } else {
      if (!config.operator) {
        throw new Error('Uninitialized database requires operator bootstrap credentials')
      }
      if (
        !config.operator.email ||
        !config.operator.password ||
        !config.operator.userId ||
        !config.operator.profileId
      ) {
        throw new Error(
          'Incomplete bootstrap operator credentials. Required when bootstrapping: OWN_RELAY_OPERATOR_EMAIL, OWN_RELAY_OPERATOR_PASSWORD, OWN_RELAY_OPERATOR_USER_ID, OWN_RELAY_OPERATOR_PROFILE_ID'
        )
      }
      await bootstrapOperatorAccount(
        securityState,
        {
          email: config.operator.email,
          password: config.operator.password,
          userId: config.operator.userId,
          profileId: config.operator.profileId,
          organizationId: config.operator.organizationId ?? ''
        },
        passwordPolicy
      )
    }
  } catch (err) {
    try {
      await securityState.close()
    } catch {
      // ignore
    }
    throw err
  }

  let server
  try {
    server = await listenOwnMobileRelay({
      securityState,
      origin: config.origin,
      authOrigin: config.authOrigin,
      clientId: config.clientId,
      listenHost: config.listenHost,
      listenPort: config.listenPort,
      silenceLimitMs: options.silenceLimitMs,
      passwordPolicy,
      throttle: options.throttle
    })
  } catch (err) {
    try {
      await securityState.close()
    } catch {
      // ignore
    }
    throw err
  }

  const instance: OwnRelayServerInstance = {
    origin: server.origin,
    boundPort: server.boundPort,
    close: async () => {
      await server.close()
      try {
        await securityState.close()
      } catch {
        // ignore
      }
    }
  }

  return instance
}

export type RelayCliOptions = {
  argv: string[]
  env?: Record<string, string | undefined>
}

export type RelayCliResult = {
  exitCode: number
  stdout?: string
  stderr?: string
}

export async function runRelayCli(options: RelayCliOptions): Promise<RelayCliResult> {
  const [command, ...restArgs] = options.argv

  if (command === 'account') {
    return runAccountCli({
      args: restArgs,
      env: options.env
    })
  }

  if (command === 'serve' || command === undefined) {
    if (restArgs.length > 0) {
      return {
        exitCode: 1,
        stderr: `[own-mobile-relay] Unexpected arguments for serve command: ${restArgs.join(' ')}\n`
      }
    }
    return { exitCode: 0 }
  }

  return {
    exitCode: 1,
    stderr: `[own-mobile-relay] Unknown command: ${command}. Available commands: serve, account\n`
  }
}

export async function main(): Promise<void> {
  try {
    checkRuntimeRequirements()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    process.stderr.write(`[own-mobile-relay] Runtime error: ${msg}\n`)
    process.exit(1)
  }

  const rawArgs = process.argv.slice(2)
  const cli = await runRelayCli({ argv: rawArgs })
  if (cli.stdout) {
    process.stdout.write(cli.stdout)
  }
  if (cli.stderr) {
    process.stderr.write(cli.stderr)
  }
  if (cli.exitCode !== 0 || rawArgs[0] === 'account') {
    process.exit(cli.exitCode)
  }

  let config: OwnRelayServeConfig
  try {
    config = parseOwnRelayServeConfig(process.env)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`[own-mobile-relay] Config error: ${message}\n`)
    process.exit(1)
  }

  try {
    const serverInstance = await startOwnRelayServer({ config })
    process.stdout.write(
      `[own-mobile-relay] Listening on ${config.listenHost}:${serverInstance.boundPort}, advertised origin: ${serverInstance.origin}, auth origin: ${config.authOrigin}\n`
    )

    let isClosing = false
    const handleSignal = (signal: string): void => {
      if (isClosing) {
        return
      }
      isClosing = true
      process.stdout.write(`[own-mobile-relay] Received ${signal}, closing server...\n`)
      void serverInstance
        .close()
        .then(() => {
          process.stdout.write('[own-mobile-relay] Server closed, exiting.\n')
          process.exit(0)
        })
        .catch((err) => {
          process.stderr.write(`[own-mobile-relay] Error during shutdown: ${String(err)}\n`)
          process.exit(1)
        })
    }

    process.once('SIGTERM', () => handleSignal('SIGTERM'))
    process.once('SIGINT', () => handleSignal('SIGINT'))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`[own-mobile-relay] Startup error: ${message}\n`)
    process.exit(1)
  }
}

if (typeof require !== 'undefined' && require.main === module) {
  void main()
}
