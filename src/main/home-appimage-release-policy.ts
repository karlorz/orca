import { z } from 'zod'
import { compareHomeTags } from './orca-home-appimage-install'
import { KARLORZ_FORK_RELEASE_FEED } from './updater-release-feeds'

export const HOME_UPDATE_RUNBOOK =
  'https://github.com/karlorz/orca/blob/fork-main/docs/reference/linux-home-appimage-install.md#attended-daemon-protocol-update'
export const HOME_UPDATE_PROTOCOL_MESSAGE = `This release requires an attended daemon protocol update. Orca remains running. Follow the attended runbook: ${HOME_UPDATE_RUNBOOK}`
const HOME_UPDATE_PROTOCOL_PREFIX = 'This release requires an attended daemon protocol update'
const HOME_UPDATE_METADATA_UNAVAILABLE_PREFIX = 'Could not read the daemon protocol metadata'
const HOME_UPDATE_DAEMON_STATE_UNKNOWN_PREFIX = 'Could not verify the live terminal daemons'

/**
 * Why three kinds: one attended message used to cover a real protocol crossing, a failed metadata
 * fetch and an unreadable daemon inventory, so transient failures looked like a policy block.
 * Only `protocol-mismatch` is attended. The other two are retryable in the sense that a human may
 * re-run the check; every install step still re-asserts the gate and blocks until it passes.
 */
export type HomeUpdateGateKind =
  | 'protocol-mismatch'
  | 'metadata-unavailable'
  | 'daemon-state-unknown'
export type HomeDaemonStateUnknownReason = 'timeout' | 'adapter-error' | 'none-live' | 'unavailable'

/** Live daemon inventory: verified protocols, or why no generation could be verified. */
export type HomeLiveDaemonState =
  | { protocols: readonly number[]; skipped?: readonly number[] }
  | { protocols: null; reason: HomeDaemonStateUnknownReason; detail?: string }

export class HomeUpdateGateError extends Error {
  constructor(
    readonly kind: HomeUpdateGateKind,
    message: string,
    readonly reason?: string
  ) {
    super(message)
    this.name = 'HomeUpdateGateError'
  }

  get retryable(): boolean {
    return this.kind !== 'protocol-mismatch'
  }
}

export function homeUpdateProtocolMismatchMessage(detail: string): string {
  return `${HOME_UPDATE_PROTOCOL_PREFIX} (${detail}). Orca remains running. Follow the attended runbook: ${HOME_UPDATE_RUNBOOK}`
}

export function homeUpdateMetadataUnavailableMessage(tag: string, cause: string): string {
  return `${HOME_UPDATE_METADATA_UNAVAILABLE_PREFIX} for ${tag} (${cause}). The update stays blocked; check again later.`
}

export function homeUpdateDaemonStateUnknownMessage(
  reason: HomeDaemonStateUnknownReason,
  detail?: string
): string {
  const explained = {
    timeout: 'the daemon inventory timed out',
    'adapter-error': 'a daemon generation failed to answer',
    'none-live': 'no live daemon generation answered',
    unavailable: 'the daemon inventory is unavailable'
  }[reason]
  const suffix = detail ? `: ${detail}` : ''
  return `${HOME_UPDATE_DAEMON_STATE_UNKNOWN_PREFIX} (${reason}: ${explained}${suffix}). The update stays blocked; check again once Orca's terminal daemon is running.`
}

/** Classifies an updater status message; the CLI only sees UpdateStatus.message across the seam. */
export function classifyHomeUpdateGateMessage(message: string): HomeUpdateGateKind | null {
  if (message.startsWith(HOME_UPDATE_PROTOCOL_PREFIX)) {
    return 'protocol-mismatch'
  }
  if (message.startsWith(HOME_UPDATE_METADATA_UNAVAILABLE_PREFIX)) {
    return 'metadata-unavailable'
  }
  if (message.startsWith(HOME_UPDATE_DAEMON_STATE_UNKNOWN_PREFIX)) {
    return 'daemon-state-unknown'
  }
  return null
}

/** Brief, URL-free cause: CDN redirects can carry signed query strings that must not be echoed. */
export function briefHomeUpdateCause(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  const text = raw
    .replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, '<url>')
    .replace(/\s+/g, ' ')
    .trim()
  return (text || 'unknown error').slice(0, 160)
}

export function normalizeHomeLiveDaemonState(
  value: readonly number[] | HomeLiveDaemonState | null
): HomeLiveDaemonState {
  if (value === null) {
    return { protocols: null, reason: 'unavailable' }
  }
  if (Array.isArray(value)) {
    return { protocols: value as readonly number[] }
  }
  return value as HomeLiveDaemonState
}

export const homeReleaseTag = z.string().regex(/^v\d+\.\d+\.\d+-\d+$/)
const assetSchema = z.object({ name: z.string(), browser_download_url: z.string().url() })
const releaseSchema = z.object({
  tag_name: homeReleaseTag,
  draft: z.boolean(),
  prerelease: z.boolean(),
  assets: z.array(assetSchema)
})
export type HomeAppImageRelease = z.infer<typeof releaseSchema>
export const homeProtocolMetadata = z.object({
  schemaVersion: z.literal(1),
  tag: homeReleaseTag,
  daemonProtocol: z.number().int().positive()
})
export type HomeProtocolMetadata = z.infer<typeof homeProtocolMetadata>

export const compareHomeReleaseTags = compareHomeTags

export function selectHomeAppImageRelease(
  value: unknown,
  currentTag: string
): HomeAppImageRelease | null {
  if (!Array.isArray(value)) {
    throw new Error('Invalid fork release feed')
  }
  const candidates = value.flatMap((entry) => {
    const result = releaseSchema.safeParse(entry)
    return result.success &&
      !result.data.draft &&
      ['orca-linux.AppImage', 'SHA256SUMS.txt'].every((name) =>
        result.data.assets.some((asset) => asset.name === name)
      )
      ? [result.data]
      : []
  })
  candidates.sort((a, b) => compareHomeReleaseTags(b.tag_name, a.tag_name))
  return (
    candidates.find((release) => compareHomeReleaseTags(release.tag_name, currentTag) > 0) ?? null
  )
}

const HOME_RELEASE_ASSET_NAMES = [
  'orca-linux.AppImage',
  'SHA256SUMS.txt',
  'orca-update-protocol.json'
] as const

export function parseHomeDesktopTagsFromAtom(xml: string): string[] {
  if (!/<feed[\s>]/i.test(xml)) {
    throw new Error('Invalid fork release atom feed')
  }
  const pattern = new RegExp(KARLORZ_FORK_RELEASE_FEED.tagHrefPattern.source, 'g')
  const tags: string[] = []
  const seen = new Set<string>()
  for (const match of xml.matchAll(pattern)) {
    const tag = match[1]
    if (
      !homeReleaseTag.safeParse(tag).success ||
      !KARLORZ_FORK_RELEASE_FEED.desktopTagPattern.test(tag) ||
      seen.has(tag)
    ) {
      continue
    }
    seen.add(tag)
    tags.push(tag)
  }
  tags.sort((left, right) => compareHomeReleaseTags(right, left))
  return tags
}

export function homeReleaseFromDesktopTag(tag: string): HomeAppImageRelease {
  if (!homeReleaseTag.safeParse(tag).success) {
    throw new Error('Expected a fork desktop release tag')
  }
  return {
    tag_name: tag,
    draft: false,
    prerelease: true,
    assets: HOME_RELEASE_ASSET_NAMES.map((name) => ({
      name,
      browser_download_url: `${KARLORZ_FORK_RELEASE_FEED.releaseDownloadBase}/${tag}/${name}`
    }))
  }
}

export function homeReleaseAssetUrl(release: HomeAppImageRelease, name: string): string {
  const assets = release.assets.filter((asset) => asset.name === name)
  if (assets.length !== 1) {
    throw new Error(`Release ${release.tag_name} needs exactly one ${name}`)
  }
  const url = new URL(assets[0].browser_download_url)
  const expected = `/karlorz/orca/releases/download/${release.tag_name}/${name}`
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'github.com' ||
    decodeURIComponent(url.pathname) !== expected ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error('Fork release asset URL is outside its immutable tag')
  }
  return url.href
}

export function assertHomeDaemonProtocol(
  metadata: HomeProtocolMetadata,
  tag: string,
  live: readonly number[] | HomeLiveDaemonState | null
): void {
  if (metadata.tag !== tag) {
    throw new HomeUpdateGateError(
      'protocol-mismatch',
      homeUpdateProtocolMismatchMessage(`protocol metadata names ${metadata.tag}, not ${tag}`),
      'metadata-tag-mismatch'
    )
  }
  const state = normalizeHomeLiveDaemonState(live)
  // Guardrail: an empty or unknown inventory never authorizes an install.
  if (state.protocols === null || state.protocols.length === 0) {
    const reason = state.protocols === null ? state.reason : 'none-live'
    const detail = state.protocols === null ? state.detail : undefined
    throw new HomeUpdateGateError(
      'daemon-state-unknown',
      homeUpdateDaemonStateUnknownMessage(reason, detail),
      reason
    )
  }
  const protocols = state.protocols
  if (protocols.some((protocol) => protocol !== metadata.daemonProtocol)) {
    throw new HomeUpdateGateError(
      'protocol-mismatch',
      homeUpdateProtocolMismatchMessage(
        `${tag} needs daemon protocol ${metadata.daemonProtocol}; live daemons: ${[...new Set(protocols)].sort((a, b) => a - b).join(', ')}`
      ),
      'protocol-mismatch'
    )
  }
}
