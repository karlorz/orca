import { spawnSync } from 'node:child_process'

const DESKTOP_TAG = /^v\d+\.\d+\.\d+(?:-rc\.\d+)?$/
const MOBILE_TAG = /^mobile-android-v\d+\.\d+\.\d+$/

export function classifyReleaseTrain(tagName) {
  if (typeof tagName !== 'string') {
    return 'ignore'
  }
  if (DESKTOP_TAG.test(tagName)) {
    return 'desktop'
  }
  if (MOBILE_TAG.test(tagName)) {
    return 'mobile'
  }
  return 'ignore'
}

export function selectLatestTrains(releases) {
  const latest = { desktop: null, mobile: null }
  for (const release of releases ?? []) {
    if (release?.draft) {
      continue
    }
    const train = classifyReleaseTrain(release.tag_name)
    if (train === 'ignore') {
      continue
    }
    const publishedAt = release.published_at ?? ''
    const current = latest[train]
    if (!current || publishedAt > current.publishedAt) {
      latest[train] = {
        train,
        tag: release.tag_name,
        prerelease: Boolean(release.prerelease),
        publishedAt,
        url: release.html_url ?? `https://github.com/stablyai/orca/releases/tag/${release.tag_name}`
      }
    }
  }
  return latest
}

export function formatTrainReport(trains) {
  const lines = [
    'upstream trains (prerelease and stable; newest published_at wins)',
    formatTrainLine('desktop', trains.desktop),
    formatTrainLine('mobile', trains.mobile)
  ]
  return `${lines.join('\n')}\n`
}

function formatTrainLine(train, entry) {
  if (!entry) {
    return `${train}: none`
  }
  const channel = entry.prerelease ? 'prerelease' : 'stable'
  return `${train}: ${entry.tag} (${channel}) ${entry.url}`
}

export function loadUpstreamReleases() {
  const result = spawnSync(
    'gh',
    [
      'release',
      'list',
      '--repo',
      'stablyai/orca',
      '--limit',
      '100',
      '--json',
      'tagName,isPrerelease,isDraft,publishedAt'
    ],
    { encoding: 'utf8' }
  )
  if (result.status !== 0) {
    throw new Error(result.stderr || 'gh release list failed')
  }
  const parsed = JSON.parse(result.stdout)
  return parsed.map((release) => ({
    tag_name: release.tagName,
    prerelease: release.isPrerelease,
    draft: release.isDraft,
    published_at: release.publishedAt,
    html_url: `https://github.com/stablyai/orca/releases/tag/${release.tagName}`
  }))
}

function main() {
  const trains = selectLatestTrains(loadUpstreamReleases())
  process.stdout.write(formatTrainReport(trains))
  process.stdout.write(`${JSON.stringify(trains, null, 2)}\n`)
  if (!trains.desktop || !trains.mobile) {
    throw new Error('expected both desktop and mobile upstream trains')
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}
