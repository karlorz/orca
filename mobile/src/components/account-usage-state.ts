// Keep shapes aligned with shared types/rate-limit-types without pulling Electron-coupled desktop graph into mobile.
// Pure RN-free selectors stay directly testable; AccountUsage re-exports them with UsageBar.
import { formatResetCountdown } from '../../../src/shared/rate-limit-reset-format'
import type {
  AccountsSnapshot,
  InactiveAccountUsage,
  ProviderRateLimits
} from './accounts-snapshot'

export {
  AccountsSnapshotSchema,
  decodeAccountsSnapshot,
  ProviderRateLimitsSchema,
  RateLimitRuntimeTargetSchema,
  type AccountsSnapshot,
  type ClaudeAccountSummary,
  type CodexAccountSummary,
  type InactiveAccountUsage,
  type ProviderRateLimits,
  type RateLimitRuntimeTarget,
  type RateLimitWindow
} from './accounts-snapshot'

// Why: only Claude and Codex have Orca-managed accounts and interactive
// switching (add/re-auth stays desktop-only). Everything else is display-only
// usage, so account-switching selectors accept only this narrow type — a
// display-only provider can never route to accounts.selectClaude/selectCodex.
export type ManagedAccountProviderKey = 'claude' | 'codex'
export type UsageProviderKey =
  | ManagedAccountProviderKey
  | 'gemini'
  | 'antigravity'
  | 'opencode-go'
  | 'kimi'
  | 'minimax'
  | 'grok'
  | 'cursor'

// Kept as an alias so existing switching call sites stay constrained to the
// two managed providers.
export type ProviderKey = ManagedAccountProviderKey

// The snapshot rateLimits field a provider's usage lives under. Distinct from
// the wire id: OpenCode Go's id is 'opencode-go' but its field is 'opencodeGo'.
type ProviderSnapshotField =
  | 'claude'
  | 'codex'
  | 'gemini'
  | 'antigravity'
  | 'opencodeGo'
  | 'kimi'
  | 'minimax'
  | 'grok'
  | 'cursor'

export type UsageProviderDescriptor =
  | {
      id: ManagedAccountProviderKey
      label: string
      snapshotField: ManagedAccountProviderKey
      managed: true
    }
  | {
      id: Exclude<UsageProviderKey, ManagedAccountProviderKey>
      label: string
      snapshotField: ProviderSnapshotField
      managed: false
    }

// Single source that maps the stable preference/wire id to its snapshot field,
// label, and whether it supports account switching. Drives iteration order,
// visibility toggles, and field lookup.
export const USAGE_PROVIDERS: readonly UsageProviderDescriptor[] = [
  { id: 'claude', label: 'Claude', snapshotField: 'claude', managed: true },
  { id: 'codex', label: 'Codex', snapshotField: 'codex', managed: true },
  { id: 'gemini', label: 'Gemini', snapshotField: 'gemini', managed: false },
  {
    id: 'antigravity',
    label: 'Antigravity',
    snapshotField: 'antigravity',
    managed: false
  },
  {
    id: 'opencode-go',
    label: 'OpenCode Go',
    snapshotField: 'opencodeGo',
    managed: false
  },
  { id: 'kimi', label: 'Kimi', snapshotField: 'kimi', managed: false },
  { id: 'minimax', label: 'MiniMax', snapshotField: 'minimax', managed: false },
  { id: 'grok', label: 'Grok', snapshotField: 'grok', managed: false },
  { id: 'cursor', label: 'Cursor', snapshotField: 'cursor', managed: false }
]

export const USAGE_PROVIDER_IDS: readonly UsageProviderKey[] = USAGE_PROVIDERS.map((p) => p.id)

// Providers shown by default when the user has never opened the filter — the
// two primary agents, matching the phone's historical behavior and the rule
// that the phone must not surface every provider at once.
export const DEFAULT_VISIBLE_USAGE_PROVIDERS: readonly UsageProviderKey[] = ['claude', 'codex']

export function getUsageProviderDescriptor(
  provider: UsageProviderKey
): UsageProviderDescriptor | null {
  return USAGE_PROVIDERS.find((p) => p.id === provider) ?? null
}

export type UsageBarState = {
  usedPercent: number | null
  unavailable: boolean
  loading: boolean
}

export function getActiveProviderRateLimits(
  snapshot: AccountsSnapshot,
  provider: UsageProviderKey
): ProviderRateLimits | null {
  const field = getUsageProviderDescriptor(provider)?.snapshotField
  if (!field) {
    return null
  }
  // `?? null` normalizes a field missing from an old cached snapshot.
  return snapshot.rateLimits[field] ?? null
}

export function getInactiveProviderUsage(
  snapshot: AccountsSnapshot,
  provider: ManagedAccountProviderKey,
  accountId: string
): InactiveAccountUsage | null {
  const list =
    provider === 'claude'
      ? snapshot.rateLimits.inactiveClaudeAccounts
      : snapshot.rateLimits.inactiveCodexAccounts
  return list.find((u) => u.accountId === accountId) ?? null
}

// System-default logins still fetch quota without managed accounts. Show successful provider or any window data; empty unavailable/error means no credentials.
export function hasActiveProviderUsage(limits: ProviderRateLimits | null): boolean {
  if (!limits) {
    return false
  }
  if (
    limits.session != null ||
    limits.weekly != null ||
    limits.monthly != null ||
    (limits.buckets && limits.buckets.length > 0)
  ) {
    return true
  }
  return limits.status === 'ok'
}

// Determine availability per window because transient provider errors retain successful window data.
export function getUsageBarState(
  limits: ProviderRateLimits | null,
  windowKey: 'session' | 'weekly',
  isFetchingOverride?: boolean
): UsageBarState {
  const window = limits?.[windowKey] ?? null
  const fetching =
    isFetchingOverride ?? (limits?.status === 'fetching' || limits?.status === 'idle')
  return {
    usedPercent: window?.usedPercent ?? null,
    unavailable: window == null && !fetching,
    loading: fetching && window == null
  }
}

export type UsageWindowRow = {
  key: string
  label: string
  usedPercent: number
  resetsAt: number | null
}

// Why: providers do not share one fixed pair of windows. Gemini reports named
// per-model buckets, OpenCode Go reports a monthly window, others report
// session (5h) / weekly (7d). Return the labelled rows a provider actually has
// so display-only sections render each provider's real usage instead of two
// hardcoded 5h/7d bars that would show dashes for buckets/monthly.
export function getProviderUsageWindows(limits: ProviderRateLimits | null): UsageWindowRow[] {
  if (!limits) {
    return []
  }
  const buckets = limits.buckets ?? []
  const rows: UsageWindowRow[] = []
  // Why: named buckets replace only the synthesized session summary; independent
  // weekly/monthly windows still belong beside them, matching desktop behavior.
  if (buckets.length > 0) {
    rows.push(
      ...buckets.map((bucket, index) => ({
        key: `bucket:${index}:${bucket.name}`,
        label: bucket.name,
        usedPercent: bucket.usedPercent,
        resetsAt: bucket.resetsAt
      }))
    )
  } else if (limits.session) {
    rows.push({
      key: 'session',
      label: '5h',
      usedPercent: limits.session.usedPercent,
      resetsAt: limits.session.resetsAt
    })
  }
  if (limits.weekly) {
    rows.push({
      key: 'weekly',
      label: '7d',
      usedPercent: limits.weekly.usedPercent,
      resetsAt: limits.weekly.resetsAt
    })
  }
  if (limits.monthly) {
    rows.push({
      key: 'monthly',
      label: '30d',
      usedPercent: limits.monthly.usedPercent,
      resetsAt: limits.monthly.resetsAt
    })
  }
  return rows
}

export function getUsageWindowResetLabel(window: UsageWindowRow, now: number): string | null {
  return window.resetsAt == null ? null : formatResetCountdown(window.resetsAt - now)
}

/**
 * Reset countdown for one window, e.g. "Resets in 3h 54m" / "Resets now",
 * or null when the window has no reset timestamp (so the UI degrades to
 * today's bars-only layout).
 *
 * Why: shares formatResetCountdown with the desktop status-bar tooltip so the
 * copy stays identical across surfaces. `now` is a parameter so the function
 * stays pure and unit-testable.
 */
export function getWindowResetLabel(
  limits: ProviderRateLimits | null,
  windowKey: 'session' | 'weekly',
  now: number
): string | null {
  const resetsAt = limits?.[windowKey]?.resetsAt
  if (resetsAt == null) {
    return null
  }
  return formatResetCountdown(resetsAt - now)
}

// Why: the usage UI must render for the system-default login, not only for
// Orca-managed accounts. Show a provider when it has at least one managed
// account OR active rate-limit data for the system-default target.
export function hasRenderableUsage(
  snapshot: AccountsSnapshot,
  provider: UsageProviderKey
): boolean {
  const descriptor = getUsageProviderDescriptor(provider)
  if (descriptor?.managed) {
    const accounts = provider === 'claude' ? snapshot.claude.accounts : snapshot.codex.accounts
    if (accounts.length > 0) {
      return true
    }
  }
  const limits = getActiveProviderRateLimits(snapshot, provider)
  if (!descriptor?.managed && (limits?.status === 'fetching' || limits?.status === 'error')) {
    return true
  }
  return hasActiveProviderUsage(limits)
}

export function hasVisibleRenderableUsage(
  snapshot: AccountsSnapshot,
  visibleProviders: ReadonlySet<UsageProviderKey>
): boolean {
  for (const provider of visibleProviders) {
    if (hasRenderableUsage(snapshot, provider)) {
      return true
    }
  }
  return false
}
