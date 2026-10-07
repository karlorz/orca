import { z } from 'zod'

const sessionIdentity = z
  .string()
  .trim()
  .min(1)
  .max(512)
  .refine((value) => !value.includes('\0'))

export const TerminalSwitchOrigin = z.object({
  provider: z.enum(['grok', 'codex', 'claude', 'cursor']),
  session: sessionIdentity,
  workspace: z
    .string()
    .trim()
    .min(1)
    .max(4096)
    .refine((value) => !value.includes('\0'))
    .optional(),
  navigation: z.enum(['caller', 'host']).optional()
})
