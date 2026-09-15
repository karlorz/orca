export type PauseLatchEvent =
  | 'pause'
  | 'resume-chip'
  | 'media-play-after-pause'
  | 'js-hold'
  | 'master-off'
  | 'js-release'
  | 'persist-off-stop'

export type PauseLatchHoldSource = 'resume-chip' | 'media-play-after-pause' | 'js-hold'

export function nextPauseLatched(latched: boolean, event: PauseLatchEvent): boolean {
  switch (event) {
    case 'pause':
      return true
    case 'resume-chip':
    case 'media-play-after-pause':
    case 'master-off':
    case 'js-release':
    case 'persist-off-stop':
      return false
    case 'js-hold':
      return latched
  }
}

export function pauseLatchRefusesSpeak(latched: boolean): boolean {
  return latched
}

export function pauseLatchAllowsHold(latched: boolean, source: PauseLatchHoldSource): boolean {
  if (!latched) {
    return true
  }
  return source === 'resume-chip' || source === 'media-play-after-pause'
}
