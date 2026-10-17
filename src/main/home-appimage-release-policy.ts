import { z } from 'zod'
import { compareHomeTags } from './orca-home-appimage-install'
import { KARLORZ_FORK_RELEASE_FEED } from './updater-release-feeds'

export const HOME_UPDATE_RUNBOOK =
  'https://github.com/karlorz/orca/blob/fork-main/docs/reference/linux-home-appimage-install.md#attended-daemon-protocol-update'
export const HOME_UPDATE_PROTOCOL_MESSAGE = `This release requires an attended daemon protocol update. Orca remains running. Follow the attended runbook: ${HOME_UPDATE_RUNBOOK}`

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
  liveProtocols: readonly number[] | null
): void {
  if (
    metadata.tag !== tag ||
    !liveProtocols?.length ||
    liveProtocols.some((protocol) => protocol !== metadata.daemonProtocol)
  ) {
    throw new Error(HOME_UPDATE_PROTOCOL_MESSAGE)
  }
}
