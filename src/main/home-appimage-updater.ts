import { mkdtemp, mkdir, open, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { compareHomeTags } from './orca-home-appimage-install'
import type { UpdateStatus } from '../shared/update-status-types'
import {
  assertHomeDaemonProtocol,
  homeProtocolMetadata,
  homeReleaseAssetUrl,
  HOME_UPDATE_PROTOCOL_MESSAGE,
  type HomeAppImageRelease,
  type HomeProtocolMetadata
} from './home-appimage-release-policy'
import {
  DEFAULT_FETCH_TIMEOUT_MS,
  discoverHomeAppImageRelease
} from './home-appimage-release-discovery'
import { requireHomeUpdateResponse } from './home-appimage-release-request'

const APPIMAGE_FETCH_TIMEOUT_MS = 30 * 60_000

export type HomeAppImageUpdaterOptions = {
  root: string
  runningTag: string
  fetch: (url: string, init?: RequestInit) => Promise<Response>
  liveProtocols: () => Promise<readonly number[] | null>
  reconcile: () => Promise<{ tag: string }>
  commit: (stage: string, tag: string) => Promise<void>
  lock: () => Promise<() => Promise<void>>
  sendStatus: (status: UpdateStatus) => void
  prepareRestart?: () => Promise<void>
  restart: () => Promise<void>
  restartAborted: () => void
  recordCheck: () => void
}

export class HomeAppImageUpdater {
  private busy = false
  private ready = false
  private selected: { release: HomeAppImageRelease; metadata: HomeProtocolMetadata } | null = null
  private downloadedTag: string | null = null
  private initialization: Promise<void> | null = null
  private userInitiated = false

  constructor(private readonly options: HomeAppImageUpdaterOptions) {}

  initialize(): Promise<void> {
    this.initialization ??= this.prepareInstall().catch((error) => {
      this.initialization = null
      throw error
    })
    return this.initialization
  }

  private async prepareInstall(): Promise<void> {
    const release = await this.options.lock()
    try {
      const installed = await this.options.reconcile()
      this.ready = true
      if (installed.tag !== this.options.runningTag) {
        const metadata = await this.readProtocolFromTag(installed.tag)
        await this.assertProtocol(metadata, installed.tag)
        // A committed image can be newer than the process still using its extracted old image.
        this.downloadedTag = installed.tag
        this.options.sendStatus({ state: 'downloaded', version: installed.tag.slice(1) })
      }
    } finally {
      await release()
    }
  }

  async check(userInitiated = false): Promise<void> {
    this.userInitiated ||= userInitiated
    if (this.busy || this.downloadedTag) {
      return
    }
    this.busy = true
    this.options.sendStatus({ state: 'checking', userInitiated: this.userInitiated })
    try {
      await this.initialize()
      if (this.downloadedTag) {
        return
      }
      this.selected = null
      const release = await discoverHomeAppImageRelease(this.options.fetch, this.options.runningTag)
      if (!release) {
        this.options.sendStatus({ state: 'not-available', userInitiated: this.userInitiated })
      } else {
        const metadata = await this.readProtocol(release)
        await this.assertProtocol(metadata, release.tag_name)
        this.selected = { release, metadata }
        this.options.sendStatus({
          state: 'available',
          version: release.tag_name.slice(1),
          changelog: null,
          releaseUrl: `https://github.com/karlorz/orca/releases/tag/${release.tag_name}`
        })
      }
      this.options.recordCheck()
    } catch (error) {
      this.fail(error)
    } finally {
      this.busy = false
      this.userInitiated = false
    }
  }

  async download(): Promise<void> {
    if (this.busy || !this.ready || !this.selected || this.downloadedTag) {
      return
    }
    this.busy = true
    let stage: string | null = null
    let unlock: (() => Promise<void>) | null = null
    const { release, metadata } = this.selected
    try {
      this.options.sendStatus({
        state: 'downloading',
        percent: 0,
        version: release.tag_name.slice(1)
      })
      await this.assertProtocol(metadata, release.tag_name)
      unlock = await this.options.lock()
      const installed = await this.options.reconcile()
      if (compareHomeTags(installed.tag, release.tag_name) >= 0) {
        throw new Error('The installed release has advanced. Restart Orca to use the current pin.')
      }
      await mkdir(this.options.root, { recursive: true })
      stage = await mkdtemp(path.join(this.options.root, '.download.'))
      const sums = await this.fetchOk(homeReleaseAssetUrl(release, 'SHA256SUMS.txt'))
      await writeFile(path.join(stage, 'SHA256SUMS.txt'), await sums.text(), {
        flag: 'wx',
        mode: 0o600
      })
      const image = await this.fetchOk(
        homeReleaseAssetUrl(release, 'orca-linux.AppImage'),
        APPIMAGE_FETCH_TIMEOUT_MS
      )
      if (!image.body) {
        throw new Error('AppImage download returned an empty body')
      }
      const file = await open(path.join(stage, 'orca-linux.AppImage'), 'wx', 0o700)
      let received = 0
      const total = Number(image.headers.get('content-length'))
      try {
        for await (const bytes of image.body) {
          received += bytes.length
          if (received > 4 * 1024 ** 3) {
            throw new Error('AppImage exceeds the download size limit')
          }
          // FileHandle.write may perform a short write.
          let offset = 0
          while (offset < bytes.length) {
            const result = await file.write(bytes, offset, bytes.length - offset)
            if (!result.bytesWritten) {
              throw new Error('AppImage staging write made no progress')
            }
            offset += result.bytesWritten
          }
          this.options.sendStatus({
            state: 'downloading',
            percent: total > 0 ? Math.min(99, (received / total) * 100) : 0,
            version: release.tag_name.slice(1)
          })
        }
        await file.sync()
      } finally {
        await file.close()
      }
      await this.assertProtocol(metadata, release.tag_name)
      await this.options.commit(stage, release.tag_name)
      this.downloadedTag = release.tag_name
      this.options.sendStatus({ state: 'downloaded', version: release.tag_name.slice(1) })
    } catch (error) {
      this.fail(error)
    } finally {
      // The commit journal owns staging on an interrupted switch; recovery must keep its bytes.
      if (stage) {
        const { access } = await import('node:fs/promises')
        const pending = await access(path.join(this.options.root, '.install-pending')).then(
          () => true,
          () => false
        )
        if (!pending) {
          await rm(stage, { recursive: true, force: true })
        }
      }
      await unlock?.()
      this.busy = false
    }
  }

  async restart(): Promise<void> {
    if (this.busy || !this.downloadedTag) {
      this.options.restartAborted()
      return
    }
    this.busy = true
    let unlock: (() => Promise<void>) | null = null
    try {
      unlock = await this.options.lock()
      const installed = await this.options.reconcile()
      if (installed.tag !== this.downloadedTag) {
        throw new Error('The installed image changed. Check for updates again.')
      }
      const metadata =
        this.selected?.release.tag_name === installed.tag
          ? this.selected.metadata
          : await this.readProtocolFromTag(installed.tag)
      await this.assertProtocol(metadata, installed.tag)
      await this.options.prepareRestart?.()
      await this.assertProtocol(metadata, installed.tag)
      await unlock()
      unlock = null
      await this.options.restart()
    } catch (error) {
      this.options.restartAborted()
      this.fail(error, true)
    } finally {
      await unlock?.()
      this.busy = false
    }
  }

  private fetchOk(url: string, timeoutMs = DEFAULT_FETCH_TIMEOUT_MS): Promise<Response> {
    return requireHomeUpdateResponse(this.options.fetch, url, timeoutMs)
  }

  private async readProtocol(release: HomeAppImageRelease): Promise<HomeProtocolMetadata> {
    try {
      const url = homeReleaseAssetUrl(release, 'orca-update-protocol.json')
      const response = await this.fetchOk(url)
      return homeProtocolMetadata.parse(await response.json())
    } catch {
      throw new Error(HOME_UPDATE_PROTOCOL_MESSAGE)
    }
  }

  private async readProtocolFromTag(tag: string): Promise<HomeProtocolMetadata> {
    try {
      const response = await this.fetchOk(
        `https://github.com/karlorz/orca/releases/download/${tag}/orca-update-protocol.json`
      )
      return homeProtocolMetadata.parse(await response.json())
    } catch {
      throw new Error(HOME_UPDATE_PROTOCOL_MESSAGE)
    }
  }

  private async assertProtocol(metadata: HomeProtocolMetadata, tag: string): Promise<void> {
    assertHomeDaemonProtocol(metadata, tag, await this.options.liveProtocols())
  }

  private fail(error: unknown, install = false): void {
    const protocol = error instanceof Error && error.message === HOME_UPDATE_PROTOCOL_MESSAGE
    this.options.sendStatus({
      state: 'error',
      message: error instanceof Error ? error.message : String(error),
      userInitiated: this.userInitiated,
      retryable: !protocol,
      ...(install && !protocol ? { retryAction: 'install' as const } : {})
    })
  }
}
