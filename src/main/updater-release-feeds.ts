import { isForkDesktopVersion } from '../shared/release-channel'

export type ReleaseFeedConfig = {
  repoAtomUrl: string
  releaseDownloadBase: string
  tagHrefPattern: RegExp
  desktopTagPattern: RegExp
}

export const STABLYAI_RELEASE_FEED: ReleaseFeedConfig = {
  repoAtomUrl: 'https://github.com/stablyai/orca/releases.atom',
  releaseDownloadBase: 'https://github.com/stablyai/orca/releases/download',
  tagHrefPattern: /href="https:\/\/github\.com\/stablyai\/orca\/releases\/tag\/([^"]+)"/,
  desktopTagPattern: /^v?\d+\.\d+\.\d+(?:-rc\.\d+(?:\.perf)?)?$/
}

export const KARLORZ_FORK_RELEASE_FEED: ReleaseFeedConfig = {
  repoAtomUrl: 'https://github.com/karlorz/orca/releases.atom',
  releaseDownloadBase: 'https://github.com/karlorz/orca/releases/download',
  tagHrefPattern: /href="https:\/\/github\.com\/karlorz\/orca\/releases\/tag\/([^"]+)"/,
  desktopTagPattern: /^v\d+\.\d+\.\d+-\d+$/
}

export function selectReleaseFeed(currentVersion: string): ReleaseFeedConfig {
  return isForkDesktopVersion(currentVersion) ? KARLORZ_FORK_RELEASE_FEED : STABLYAI_RELEASE_FEED
}
