import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createReadStream } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { chromium } from '@playwright/test'

const [oldImage, newImage, reportPath] = process.argv.slice(2).map((value) => resolve(value))
if (!oldImage || !newImage || !reportPath || process.platform !== 'linux') {
  throw new Error(
    'Usage: node home-appimage-xvfb-test.mjs <old AppImage> <new AppImage> <report.json>'
  )
}
if (!process.env.DISPLAY || process.env.ORCA_BACKGROUND_LAUNCH !== '1') {
  throw new Error('Run inside an isolated xvfb-run with ORCA_BACKGROUND_LAUNCH=1')
}
const work = await mkdtemp(join(tmpdir(), 'orca-inapp-atomic-'))
const home = join(work, 'home')
const profile = join(work, 'profile')
const root = join(home, '.local', 'opt', 'orca')
const children = []
let browser
let server
let failure
const report = { oldVersion: '1.4.224-0', newVersion: '1.4.224-1', steps: [], pass: false }
try {
  for (const directory of [
    home,
    profile,
    root,
    join(work, 'runtime'),
    join(work, 'cache'),
    join(work, 'config')
  ]) {
    await mkdir(directory, { recursive: true, mode: 0o700 })
  }
  await writeFile(
    join(profile, 'orca-data.json'),
    JSON.stringify({
      onboarding: { flowVersion: 4, closedAt: 1, outcome: 'completed', lastCompletedStep: 5 },
      settings: {
        telemetry: {
          optedIn: true,
          installId: '00000000-0000-4000-8000-000000000000',
          existedBeforeTelemetryRelease: false
        }
      },
      ui: {
        contextualToursAutoEligible: false,
        projectOrderManualDefaultNoticeDismissed: true,
        usagePercentageDisplayChangeNoticeDismissed: true,
        featureTipsSeenIds: [
          'native-chat-upgrade',
          'voice-dictation',
          'orca-cli',
          'cmd-j-palette',
          'agent-session-search'
        ]
      }
    })
  )
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        !/^(ORCA_|APPIMAGE|APPDIR|ELECTRON_|CODEX_|CLAUDE_|ZCODE_|BASH_ENV$|ENV$|XDG_)/.test(key)
    )
  )
  Object.assign(env, {
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: join(work, 'config'),
    XDG_CACHE_HOME: join(work, 'cache'),
    XDG_RUNTIME_DIR: join(work, 'runtime'),
    ORCA_USER_DATA_PATH: profile,
    ORCA_E2E_USER_DATA_DIR: profile,
    ORCA_E2E_HOME_DIR: home,
    ORCA_BACKGROUND_LAUNCH: '1',
    ORCA_HOME_INSTALL_MANAGED: '1',
    APPIMAGE_EXTRACT_AND_RUN: '1',
    ORCA_HOME_INSTALL_DIR: root,
    LIBGL_ALWAYS_SOFTWARE: '1'
  })
  const { commitHomeAppImage, reconcileHomeAppImage } =
    await import('./orca-home-appimage-install.ts')
  const extract = async (image, cwd) => {
    for (const resource of [
      'resources/package-type',
      'resources/orcad-template/orcad-template.json'
    ]) {
      await new Promise((accept, reject) => {
        const child = spawn(image, ['--appimage-extract', resource], {
          cwd,
          env,
          stdio: 'ignore'
        })
        child.once('error', reject)
        child.once('exit', (code) =>
          code === 0 ? accept() : reject(new Error(`Marker extraction exit ${code}`))
        )
      })
    }
  }
  const { createHash } = await import('node:crypto')
  const digest = async (image) => {
    const hash = createHash('sha256')
    for await (const bytes of createReadStream(image)) {
      hash.update(bytes)
    }
    return hash.digest('hex')
  }
  const oldStage = await mkdtemp(join(root, '.download.'))
  const { copyFile } = await import('node:fs/promises')
  await copyFile(oldImage, join(oldStage, 'orca-linux.AppImage'))
  await writeFile(
    join(oldStage, 'SHA256SUMS.txt'),
    `${await digest(oldImage)}  orca-linux.AppImage\n`
  )
  await commitHomeAppImage(root, oldStage, 'v1.4.224-0', extract)
  report.steps.push('old image installed and pin verified')
  const metadata = { schemaVersion: 1, tag: 'v1.4.224-1', daemonProtocol: 44 }
  const newSha = await digest(newImage)
  server = createServer((req, res) => {
    if (req.url === '/releases') {
      res.setHeader('content-type', 'application/json')
      res.end(
        JSON.stringify([
          {
            tag_name: metadata.tag,
            draft: false,
            prerelease: true,
            assets: ['orca-linux.AppImage', 'SHA256SUMS.txt', 'orca-update-protocol.json'].map(
              (name) => ({
                name,
                browser_download_url: `https://github.com/karlorz/orca/releases/download/${metadata.tag}/${name}`
              })
            )
          }
        ])
      )
    } else if (req.url === '/orca-update-protocol.json') {
      res.end(JSON.stringify(metadata))
    } else if (req.url === '/SHA256SUMS.txt') {
      res.end(`${newSha}  orca-linux.AppImage\n`)
    } else if (req.url === '/orca-linux.AppImage') {
      createReadStream(newImage).pipe(res)
    } else {
      res.statusCode = 404
      res.end()
    }
  })
  await new Promise((accept) => server.listen(0, '127.0.0.1', accept))
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Fixture server has no TCP address')
  }
  env.ORCA_HOME_UPDATE_FIXTURE_PORT = String(address.port)
  // Only fixture images redirect the release transport; production policy and filesystem code stay intact.
  const debugPortServer = createServer()
  await new Promise((accept) => debugPortServer.listen(0, '127.0.0.1', accept))
  const debugAddress = debugPortServer.address()
  if (!debugAddress || typeof debugAddress === 'string') {
    throw new Error('CDP port unavailable')
  }
  const debugPort = debugAddress.port
  await new Promise((accept) => debugPortServer.close(accept))
  const log = await import('node:fs').then(({ openSync }) => openSync(join(work, 'app.log'), 'a'))
  const child = spawn(
    join(root, 'orca-linux.AppImage'),
    ['--no-sandbox', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`],
    {
      env,
      detached: true,
      stdio: ['ignore', log, log]
    }
  )
  children.push(child)
  const endpoint = `http://127.0.0.1:${debugPort}`
  const waitFor = async (predicate, timeout = 120_000) => {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      try {
        const result = await predicate()
        if (result) {
          return result
        }
      } catch {}
      await new Promise((accept) => setTimeout(accept, 200))
    }
    throw new Error('Timed out waiting for isolated application state')
  }
  await waitFor(async () => (await fetch(`${endpoint}/json/version`)).ok)
  browser = await chromium.connectOverCDP(endpoint)
  let page = await waitFor(() =>
    browser
      .contexts()
      .flatMap((context) => context.pages())
      .find((candidate) => candidate.url().includes('index.html'))
  )
  await page.waitForFunction(() => Boolean(window.api?.updater), { timeout: 120_000 })
  assert.equal(await page.evaluate(() => window.api.updater.getVersion()), report.oldVersion)
  report.steps.push('old version running in isolated HOME/profile on Xvfb')
  // Opening settings is setup; every update action is a DOM click on the production renderer.
  await page.evaluate(() => {
    const state = window.__store?.getState()
    state?.openSettingsTarget({ pane: 'general', repoId: null })
    state?.openSettingsPage()
  })
  const check = page.getByRole('button', { name: 'Check for Updates', exact: true })
  await check.waitFor({ timeout: 120_000 })
  await waitFor(async () => !(await check.isDisabled()))
  await check.click()
  const download = page.getByRole('button', { name: /Download Update \(1\.4\.224-1\)/ })
  await download.waitFor({ timeout: 120_000 })
  report.steps.push(
    'in-app check selected newer fork prerelease with matching live daemon protocol'
  )
  await download.click()
  const restart = page.getByRole('button', { name: /Restart to Update \(1\.4\.224-1\)/ })
  await restart.waitFor({ timeout: 180_000 })
  assert.equal((await readFile(join(root, 'release-tag'), 'utf8')).trim(), metadata.tag)
  assert.equal(await digest(join(root, 'orca-linux.AppImage')), newSha)
  assert.equal(await digest(join(root, 'orca-linux.AppImage.previous')), await digest(oldImage))
  await reconcileHomeAppImage(root, `v${report.oldVersion}`, extract)
  assert.equal(await page.evaluate(() => window.api.updater.getVersion()), report.oldVersion)
  report.steps.push(
    'verified download swapped image, retained verified previous image and wrote matching pin; old process still running'
  )
  await page.screenshot({ path: reportPath.replace(/\.json$/, '-restart.png') })
  await restart.click()
  await browser.close().catch(() => {})
  browser = null
  await waitFor(async () => (await fetch(`${endpoint}/json/version`)).ok)
  await waitFor(async () => {
    const connection = await chromium.connectOverCDP(endpoint)
    const candidate = connection
      .contexts()
      .flatMap((context) => context.pages())
      .find((entry) => entry.url().includes('index.html'))
    try {
      if (
        candidate &&
        (await candidate.evaluate(() => window.api?.updater?.getVersion())) === report.newVersion
      ) {
        browser = connection
        page = candidate
        return true
      }
    } catch {}
    await connection.close()
    return false
  })
  assert.equal((await readFile(join(root, 'release-tag'), 'utf8')).trim(), metadata.tag)
  report.steps.push(
    'explicit Restart to Update click relaunched new version with same isolated profile and current pin'
  )
  report.pass = true
} catch (error) {
  failure = error
  report.error = String(error?.stack ?? error)
} finally {
  await browser?.close().catch(() => {})
  await new Promise((accept) => (server ? server.close(accept) : accept()))
  // AppImage re-execution may detach; kill only processes whose HOME is our disposable test home.
  const { readdir } = await import('node:fs/promises')
  for (const entry of await readdir('/proc')) {
    if (!/^\d+$/.test(entry)) {
      continue
    }
    try {
      const environment = await readFile(`/proc/${entry}/environ`, 'utf8')
      if (environment.split('\0').includes(`HOME=${home}`)) {
        process.kill(Number(entry), 'SIGTERM')
      }
    } catch {}
  }
  await new Promise((accept) => setTimeout(accept, 1000))
  for (const entry of await readdir('/proc')) {
    if (!/^\d+$/.test(entry)) {
      continue
    }
    try {
      const environment = await readFile(`/proc/${entry}/environ`, 'utf8')
      if (environment.split('\0').includes(`HOME=${home}`)) {
        process.kill(Number(entry), 'SIGKILL')
      }
    } catch {}
  }
  if (failure) {
    report.applicationLog = await readFile(join(work, 'app.log'), 'utf8').catch(() => '')
  }
  await mkdir(dirname(reportPath), { recursive: true })
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  await rm(work, { recursive: true, force: true })
}
console.log(JSON.stringify(report))
if (failure) {
  process.exitCode = 1
}
