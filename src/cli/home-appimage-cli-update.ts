import {
  classifyHomeUpdateGateMessage,
  compareHomeReleaseTags as compareHomeTags,
  homeReleaseTag,
  type HomeUpdateGateKind
} from '../main/home-appimage-release-policy'
import type { HomeAppImageUpdater } from '../main/home-appimage-updater'
import type { UpdateStatus } from '../shared/update-status-types'
import { RuntimeClientError } from './runtime/types'

/** Stable CLI codes per gate outcome; only the attended mismatch is non-retryable. */
const GATE_ERROR_CODES: Record<HomeUpdateGateKind, { code: string; retryable: boolean }> = {
  'protocol-mismatch': { code: 'update_protocol_required', retryable: false },
  'metadata-unavailable': { code: 'update_protocol_metadata_unavailable', retryable: true },
  'daemon-state-unknown': { code: 'update_daemon_state_unknown', retryable: true }
}

const ADVANCED_PIN_MESSAGE =
  'The installed release has advanced. Restart Orca to use the current pin.'

export type HomeUpdateCheckResult = {
  state: 'available' | 'not-available' | 'downloaded'
  runningTag: string
  installedTag: string
  selectedTag?: string
  version?: string
  releaseUrl?: string
}

export type HomeUpdateApplyResult = {
  state: 'downloaded'
  runningTag: string
  installedTag: string
  selectedTag: string
  version: string
}

export type HomeAppImageCliUpdateSession = {
  runningTag: string
  readInstalledTag: () => Promise<string>
  createUpdater: (sendStatus: (status: UpdateStatus) => void) => HomeAppImageUpdater
}

type SessionFactory = () => Promise<HomeAppImageCliUpdateSession>

let createSession: SessionFactory | null = null

export function configureHomeAppImageCliUpdate(next: SessionFactory): () => void {
  const previous = createSession
  createSession = next
  return () => {
    createSession = previous
  }
}

export async function homeAppImageCliUpdateSession(): Promise<HomeAppImageCliUpdateSession> {
  if (createSession) {
    return createSession()
  }
  const { createProductionHomeAppImageCliUpdateSession } =
    await import('./home-appimage-cli-update-session.js')
  return createProductionHomeAppImageCliUpdateSession()
}

export async function checkHomeAppImageUpdate(
  session: HomeAppImageCliUpdateSession
): Promise<HomeUpdateCheckResult> {
  const statuses: UpdateStatus[] = []
  const updater = session.createUpdater((status) => statuses.push(status))
  await updater.check(true)
  return mapCheckResult(session, lastStatus(statuses), await session.readInstalledTag())
}

export async function applyHomeAppImageUpdate(
  session: HomeAppImageCliUpdateSession
): Promise<HomeUpdateApplyResult> {
  const statuses: UpdateStatus[] = []
  const updater = session.createUpdater((status) => statuses.push(status))
  await updater.check(true)
  const installedTag = await session.readInstalledTag()
  const checked = lastStatus(statuses)
  if (checked.state === 'error') {
    throw statusError(checked, session.runningTag, installedTag)
  }
  if (checked.state === 'downloaded') {
    return downloadedResult(session.runningTag, installedTag, requireVersion(checked))
  }
  if (checked.state !== 'available') {
    throw notAvailableError(session.runningTag, installedTag)
  }
  const selectedTag = `v${checked.version}`
  refuseDowngrade(installedTag, session.runningTag, selectedTag)
  await updater.download()
  const applied = lastStatus(statuses)
  if (applied.state === 'error') {
    throw statusError(applied, session.runningTag, installedTag, selectedTag)
  }
  if (applied.state !== 'downloaded') {
    throw new RuntimeClientError('update_error', 'Home AppImage apply did not commit a pin.', {
      runningTag: session.runningTag,
      installedTag,
      selectedTag,
      state: applied.state
    })
  }
  return downloadedResult(
    session.runningTag,
    await session.readInstalledTag(),
    requireVersion(applied)
  )
}

export function formatHomeUpdateCheck(result: HomeUpdateCheckResult): string {
  if (result.state === 'not-available') {
    return `No newer home AppImage is available.\nInstalled pin: ${result.installedTag}`
  }
  if (result.state === 'downloaded') {
    return `Home AppImage ${result.selectedTag} is already committed. Restart Orca when ready.`
  }
  const release = result.releaseUrl ? `\nRelease: ${result.releaseUrl}` : ''
  return `Update available: ${result.version} (${result.selectedTag})\nInstalled pin: ${result.installedTag}${release}`
}

export function formatHomeUpdateApply(result: HomeUpdateApplyResult): string {
  return `Downloaded and committed ${result.selectedTag}. Restart Orca when ready; this command does not relaunch.`
}

function mapCheckResult(
  session: HomeAppImageCliUpdateSession,
  status: UpdateStatus,
  installedTag: string
): HomeUpdateCheckResult {
  if (status.state === 'error') {
    throw statusError(status, session.runningTag, installedTag)
  }
  if (status.state === 'not-available') {
    return { state: 'not-available', runningTag: session.runningTag, installedTag }
  }
  if (status.state === 'downloaded') {
    const version = requireVersion(status)
    return {
      state: 'downloaded',
      runningTag: session.runningTag,
      installedTag,
      selectedTag: `v${version}`,
      version
    }
  }
  if (status.state !== 'available') {
    throw new RuntimeClientError('update_error', 'Home AppImage check did not finish.', {
      runningTag: session.runningTag,
      installedTag,
      state: status.state
    })
  }
  return {
    state: 'available',
    runningTag: session.runningTag,
    installedTag,
    selectedTag: `v${status.version}`,
    version: status.version,
    ...(status.releaseUrl ? { releaseUrl: status.releaseUrl } : {})
  }
}

function refuseDowngrade(installedTag: string, runningTag: string, selectedTag: string): void {
  const pins = [installedTag, runningTag].filter((tag) => homeReleaseTag.safeParse(tag).success)
  if (pins.some((pin) => compareHomeTags(pin, selectedTag) >= 0)) {
    throw downgradeError(installedTag, runningTag, selectedTag)
  }
}

function statusError(
  status: Extract<UpdateStatus, { state: 'error' }>,
  runningTag: string,
  installedTag: string,
  selectedTag?: string
): RuntimeClientError {
  const gate = classifyHomeUpdateGateMessage(status.message)
  if (gate) {
    const { code, retryable } = GATE_ERROR_CODES[gate]
    return new RuntimeClientError(code, status.message, {
      runningTag,
      installedTag,
      ...(selectedTag ? { selectedTag } : {}),
      retryable
    })
  }
  if (status.message === ADVANCED_PIN_MESSAGE) {
    return downgradeError(installedTag, runningTag, selectedTag)
  }
  return new RuntimeClientError('update_error', status.message, {
    runningTag,
    installedTag,
    ...(selectedTag ? { selectedTag } : {}),
    retryable: status.retryable
  })
}

function notAvailableError(runningTag: string, installedTag: string): RuntimeClientError {
  return new RuntimeClientError('update_not_available', 'No newer home AppImage is available.', {
    runningTag,
    installedTag
  })
}

function downgradeError(
  installedTag: string,
  runningTag: string,
  selectedTag?: string
): RuntimeClientError {
  const selected = selectedTag ? ` ${selectedTag}` : ''
  return new RuntimeClientError(
    'update_downgrade_refused',
    `Refusing to apply${selected}; installed pin ${installedTag} is already at least as new.`,
    { runningTag, installedTag, ...(selectedTag ? { selectedTag } : {}), retryable: false }
  )
}

function downloadedResult(
  runningTag: string,
  installedTag: string,
  version: string
): HomeUpdateApplyResult {
  return {
    state: 'downloaded',
    runningTag,
    installedTag,
    selectedTag: `v${version}`,
    version
  }
}

function requireVersion(status: UpdateStatus): string {
  if (!('version' in status) || !status.version) {
    throw new RuntimeClientError(
      'update_error',
      'Home updater status omitted the selected version.'
    )
  }
  return status.version
}

function lastStatus(statuses: UpdateStatus[]): UpdateStatus {
  return statuses.at(-1) ?? { state: 'idle' }
}
