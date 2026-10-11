import type React from 'react'
import { ClaudeIcon, DroidIcon, GrokIcon, OpenAIIcon } from '@/components/status-bar/icons'
import type { TerminalAgent } from '../../../shared/terminal-agent'
import {
  AgentLetterIcon,
  AiderIcon,
  CopilotIcon,
  KiloIcon,
  OmpIcon,
  OpenCodeIcon,
  PiIcon
} from './agent-icon-glyphs'
import { AGENT_FAVICON_ASSETS } from './agent-favicon-assets'
import { getAgentCatalog } from './agent-catalog'

export function AgentIcon({
  agent,
  size = 14
}: {
  agent: TerminalAgent | null | undefined
  size?: number
}): React.JSX.Element {
  if (!agent) {
    return <AgentLetterIcon letter="?" size={size} />
  }
  if (agent === 'claude' || agent === 'claude-agent-teams') {
    return <ClaudeIcon size={size} />
  }
  if (agent === 'codex') {
    return <OpenAIIcon size={size} />
  }
  if (agent === 'droid') {
    return <DroidIcon size={size} />
  }
  if (agent === 'grok') {
    return <GrokIcon size={size} />
  }
  if (agent === 'pi') {
    return <PiIcon size={size} />
  }
  if (agent === 'omp') {
    return <OmpIcon size={size} />
  }
  if (agent === 'aider') {
    return <AiderIcon size={size} />
  }
  if (agent === 'kilo') {
    return <KiloIcon size={size} />
  }
  if (agent === 'copilot') {
    return <CopilotIcon size={size} />
  }
  if (agent === 'opencode' || agent === 'opencode2') {
    return <OpenCodeIcon size={size} />
  }
  const catalogEntry = getAgentCatalog().find((entry) => entry.id === agent)
  // Why: recognition-only DSB shares the bundled DeepSeek mark.
  const iconAgent = agent === 'dsb' ? 'dsh' : agent
  const iconSrc = catalogEntry?.iconUrl ?? AGENT_FAVICON_ASSETS[iconAgent]
  if (iconSrc) {
    return (
      <img
        src={iconSrc}
        width={size}
        height={size}
        alt=""
        aria-hidden
        style={{ borderRadius: 2 }}
      />
    )
  }
  if (catalogEntry?.faviconDomain) {
    return (
      <img
        src={`https://www.google.com/s2/favicons?domain=${catalogEntry.faviconDomain}&sz=64`}
        width={size}
        height={size}
        alt=""
        aria-hidden
        style={{ borderRadius: 2 }}
      />
    )
  }
  const label = catalogEntry?.label ?? agent
  return <AgentLetterIcon letter={label.charAt(0).toUpperCase()} size={size} />
}
