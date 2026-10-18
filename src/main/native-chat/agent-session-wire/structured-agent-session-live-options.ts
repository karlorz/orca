import type { AgentSessionOptionsResult } from '../../../shared/agent-session-wire'
import type { AgentModelCatalogLiveListing } from '../agent-model-catalog/agent-model-catalog-entry'

/** A live options read, plus what the child listed for its account's saved catalog. The host
 *  saves that listing and strips it before answering; an adapter whose listing reaches the
 *  catalog another way omits it. */
export type StructuredAgentSessionLiveOptions = AgentSessionOptionsResult & {
  catalogListing?: AgentModelCatalogLiveListing
}
