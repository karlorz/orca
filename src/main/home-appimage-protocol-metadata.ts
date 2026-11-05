import {
  briefHomeUpdateCause,
  homeProtocolMetadata,
  homeReleaseAssetUrl,
  homeReleaseFromDesktopTag,
  homeUpdateMetadataUnavailableMessage,
  homeUpdateProtocolMismatchMessage,
  HomeUpdateGateError,
  type HomeAppImageRelease,
  type HomeProtocolMetadata
} from './home-appimage-release-policy'
import { DEFAULT_FETCH_TIMEOUT_MS } from './home-appimage-release-discovery'
import { fetchHomeUpdateResponse, type HomeUpdateFetch } from './home-appimage-release-request'

const METADATA_ASSET = 'orca-update-protocol.json'

export async function readHomeReleaseProtocol(
  fetch: HomeUpdateFetch,
  release: HomeAppImageRelease
): Promise<HomeProtocolMetadata> {
  const descriptors = release.assets.filter((asset) => asset.name === METADATA_ASSET)
  // API snapshots can omit the descriptor even while the immutable asset is available.
  if (descriptors.length === 0) {
    return readHomeProtocolFromTag(fetch, release.tag_name)
  }
  if (descriptors.length > 1) {
    throw descriptorError(release.tag_name, 'duplicate')
  }
  let url: string
  try {
    url = homeReleaseAssetUrl(release, METADATA_ASSET)
  } catch {
    throw descriptorError(release.tag_name, 'invalid')
  }
  return readProtocolAt(fetch, url, release.tag_name)
}

export function readHomeProtocolFromTag(
  fetch: HomeUpdateFetch,
  tag: string
): Promise<HomeProtocolMetadata> {
  const release = homeReleaseFromDesktopTag(tag)
  return readProtocolAt(fetch, homeReleaseAssetUrl(release, METADATA_ASSET), tag)
}

async function readProtocolAt(
  fetch: HomeUpdateFetch,
  url: string,
  tag: string
): Promise<HomeProtocolMetadata> {
  let response: Response
  try {
    response = await fetchHomeUpdateResponse(fetch, url, DEFAULT_FETCH_TIMEOUT_MS)
  } catch (error) {
    throw metadataUnavailable(tag, briefHomeUpdateCause(error), 'metadata-fetch-failed')
  }
  if (response.status === 404) {
    await response.body?.cancel().catch(() => undefined)
    throw new HomeUpdateGateError(
      'protocol-mismatch',
      homeUpdateProtocolMismatchMessage(`${tag} protocol metadata request returned HTTP 404`),
      'metadata-http-404'
    )
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined)
    throw metadataUnavailable(tag, `HTTP ${response.status}`, `metadata-http-${response.status}`)
  }
  try {
    return homeProtocolMetadata.parse(await response.json())
  } catch {
    throw metadataUnavailable(tag, `invalid ${METADATA_ASSET}`, 'metadata-invalid')
  }
}

function descriptorError(tag: string, reason: 'duplicate' | 'invalid'): HomeUpdateGateError {
  return new HomeUpdateGateError(
    'protocol-mismatch',
    homeUpdateProtocolMismatchMessage(`${tag} has ${reason} ${METADATA_ASSET} descriptors`),
    `metadata-descriptor-${reason}`
  )
}

function metadataUnavailable(tag: string, cause: string, reason: string): HomeUpdateGateError {
  return new HomeUpdateGateError(
    'metadata-unavailable',
    homeUpdateMetadataUnavailableMessage(tag, cause),
    reason
  )
}
