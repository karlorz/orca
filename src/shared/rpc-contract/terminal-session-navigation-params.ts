import { z } from 'zod'
import { requiredString } from './rpc-param-primitives'

export const TerminalResolveSession = z.object({
  provider: z.literal('grok'),
  session: requiredString('Missing provider session').pipe(z.string().max(512))
})

export const TerminalSwitchSession = TerminalResolveSession.extend({
  navigation: z.enum(['caller', 'host']).optional()
})
