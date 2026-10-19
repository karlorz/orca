import {
  OrcaRuntimeWithSidebarTemporal,
  sidebarFactsRuntime
} from './sidebar-inputs/orca-runtime-sidebar-temporal'
import { OrcaRuntimeWithMigrationCatalog } from './orca-runtime-migration-catalog'
import { ORCA_SIDEBAR_INPUTS_IS_MAIN } from '../../shared/sidebar-inputs-switch'
import { PairedServerRowsProducer } from './sidebar-inputs/paired-server-rows-producer'
import { RepoIconDataUrls } from './sidebar-inputs/repo-icon-data-urls'
import { WorkspaceRowsProducer } from './sidebar-inputs/workspace-rows-producer'
import { getMainHttpClient } from '../network/http-client'
import { getRuntimeDesktopSurface } from './runtime-desktop-surface'
import { CollapseWriteOrder } from './workspace-view-collapse-writes'
import { SidebarInputsFeed } from './sidebar-inputs/sidebar-inputs-feed'
import { sidebarInputsFeedDomains } from './sidebar-inputs/sidebar-inputs-feed-domains'
import { requireSwitchedOn } from './sidebar-inputs/require-switched-on'
import { HEADLESS_RUNTIME_WINDOW_ID } from '../../shared/runtime-session-contracts'
import { getHostDisplayLabelOverrides } from '../../shared/host-setting-overrides'

// Switch point: a window-fed build keeps no sidebar facts layer.
const OrcaRuntimeSidebarBase: typeof OrcaRuntimeWithMigrationCatalog = ORCA_SIDEBAR_INPUTS_IS_MAIN
  ? OrcaRuntimeWithSidebarTemporal
  : OrcaRuntimeWithMigrationCatalog

export abstract class OrcaRuntimeWithSidebarProducers extends OrcaRuntimeSidebarBase {
  /** This runtime as its sidebar facts layer; null unless built with ORCA_SIDEBAR_INPUTS=main. */
  get sidebarFacts() {
    return sidebarFactsRuntime(this)
  }
  // Switch point. Idle until relay hosts attach; the fallback refresh runs while a window shows the sidebar or a phone reads the feed.
  readonly pairedServerRows = ORCA_SIDEBAR_INPUTS_IS_MAIN
    ? new PairedServerRowsProducer({
        hasDemand: () =>
          this.sidebarInputsFeed?.subscribed === true ||
          (this.authoritativeWindowId !== null &&
            this.authoritativeWindowId !== HEADLESS_RUNTIME_WINDOW_ID &&
            this.store?.getUI?.().sidebarOpen !== false),
        hostLabelOverrides: () => getHostDisplayLabelOverrides(this.getClientSettings())
      })
    : null
  // Switch point: the phone's icon source.
  readonly repoIconDataUrls = ORCA_SIDEBAR_INPUTS_IS_MAIN
    ? new RepoIconDataUrls({
        repos: () => this.store?.getRepos() ?? [],
        // Why not the shared desktop client: its net.fetch rejects every manual redirect.
        fetch: (url, init) => {
          const manualRedirectFetch = getRuntimeDesktopSurface().fetchRepoIcon
          return manualRedirectFetch
            ? manualRedirectFetch(url, init)
            : getMainHttpClient().fetch(url, init)
        },
        encoder: () => getRuntimeDesktopSurface().encodeRepoIconPng
      })
    : null
  // Switch point: the per-writer ordering behind ui.setCollapsed.
  readonly collapseWriteOrder = ORCA_SIDEBAR_INPUTS_IS_MAIN ? new CollapseWriteOrder() : null
  // Switch point: this host's workspace rows, from the listing worktree.ps reads.
  readonly workspaceRows = ORCA_SIDEBAR_INPUTS_IS_MAIN
    ? new WorkspaceRowsProducer({
        store: this.store,
        // Merged fresh (git scans keep their own cache): the window's metadata writes emit no
        // client event, so the shared listing may predate them.
        listVisibleWorktrees: async () =>
          this.visibleResolvedWorktreeSnapshot(await this.computeResolvedWorktrees()),
        onClientEvent: (listener, options) => this.onClientEvent(listener, options)
      })
    : null
  // Switch point: the phone's feed of the producers above; idle until this host's own phone reads.
  readonly sidebarInputsFeed = ORCA_SIDEBAR_INPUTS_IS_MAIN
    ? new SidebarInputsFeed(
        () =>
          sidebarInputsFeedDomains({
            facts: requireSwitchedOn(this.sidebarFacts),
            pairedServerRows: requireSwitchedOn(this.pairedServerRows),
            workspaceCreations: requireSwitchedOn(this.workspaceCreations),
            workspaceRows: requireSwitchedOn(this.workspaceRows),
            store: () => this.store,
            onClientEvent: (listener, options) => this.onClientEvent(listener, options)
          }),
        (event) => this.emitClientEvent(event)
      )
    : null
}
