import { z } from 'zod'

const EnvSchema = z.object({
  PORT: z.coerce.number().int().min(1024).max(65_535).default(2477),
  COOLIFY_API_URL: z.string().url().default('https://cp.karldigi.dev'),
  COOLIFY_API_TOKEN: z.string().optional().default(''),
  FORK_LIVE_STATUS_AUTH_ORIGIN: z.string().url().default('https://orca-auth.karldigi.dev'),
  FORK_LIVE_STATUS_RELAY_ORIGIN: z.string().url().default('https://orca-relay.karldigi.dev'),
  FORK_LIVE_STATUS_AUTH_APP_UUID: z.string().min(1).default('bfxz2ef22nep35ytcv6qqj0t'),
  FORK_LIVE_STATUS_RELAY_APP_UUID: z.string().min(1).default('kl8ypbofi72soo46ha1cr85i')
})

export type LiveStatusConfig = z.infer<typeof EnvSchema>

export function loadConfig(
  env: Record<string, string | undefined> = process.env
): LiveStatusConfig {
  const result = EnvSchema.safeParse(env)
  if (!result.success) {
    const messages = result.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')
    throw new Error(`Configuration validation failed: ${messages}`)
  }
  return result.data
}
