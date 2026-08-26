import process from 'node:process'
import { listenOwnMobileRelay, type OwnMobileRelayListenOptions } from './own-mobile-relay-http'

export function parseOwnRelayEnv(
  env: Record<string, string | undefined> = process.env
): OwnMobileRelayListenOptions {
  const origin = env.OWN_RELAY_ORIGIN
  if (!origin) {
    throw new Error('Missing required environment variable: OWN_RELAY_ORIGIN')
  }

  const clientId = env.OWN_RELAY_CLIENT_ID
  if (!clientId) {
    throw new Error('Missing required environment variable: OWN_RELAY_CLIENT_ID')
  }

  const email = env.OWN_RELAY_OPERATOR_EMAIL
  if (!email) {
    throw new Error('Missing required environment variable: OWN_RELAY_OPERATOR_EMAIL')
  }

  const password = env.OWN_RELAY_OPERATOR_PASSWORD
  if (!password) {
    throw new Error('Missing required environment variable: OWN_RELAY_OPERATOR_PASSWORD')
  }

  const userId = env.OWN_RELAY_OPERATOR_USER_ID
  if (!userId) {
    throw new Error('Missing required environment variable: OWN_RELAY_OPERATOR_USER_ID')
  }

  const profileId = env.OWN_RELAY_OPERATOR_PROFILE_ID
  if (!profileId) {
    throw new Error('Missing required environment variable: OWN_RELAY_OPERATOR_PROFILE_ID')
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

  const organizationId = env.OWN_RELAY_OPERATOR_ORG_ID ?? ''

  return {
    origin,
    clientId,
    listenHost,
    listenPort,
    operator: {
      email,
      password,
      userId,
      profileId,
      organizationId
    }
  }
}

export async function main(): Promise<void> {
  let options: OwnMobileRelayListenOptions
  try {
    options = parseOwnRelayEnv(process.env)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`[own-mobile-relay] Config error: ${message}\n`)
    process.exit(1)
  }

  try {
    const server = await listenOwnMobileRelay(options)
    process.stdout.write(
      `[own-mobile-relay] Listening on ${options.listenHost}:${server.boundPort}, advertised origin: ${server.origin}\n`
    )

    let isClosing = false
    const handleSignal = (signal: string): void => {
      if (isClosing) {
        return
      }
      isClosing = true
      process.stdout.write(`[own-mobile-relay] Received ${signal}, closing server...\n`)
      void server
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
