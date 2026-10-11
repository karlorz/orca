import { cp, readFile, writeFile, rm, readdir, chmod, mkdir } from 'node:fs/promises'
import { createReadStream, createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'

const [baseImage, requestedOutput] = process.argv.slice(2)
if (!baseImage || !requestedOutput || process.platform !== 'linux') {
  throw new Error(
    'Usage: node home-appimage-xvfb-fixtures.mjs <base AppImage> <temp output directory>'
  )
}
const root = path.resolve(requestedOutput)
if (!root.startsWith('/tmp/') || process.env.ORCA_BACKGROUND_LAUNCH !== '1') {
  throw new Error('Fixture packaging requires temporary output and ORCA_BACKGROUND_LAUNCH=1')
}
await mkdir(root, { mode: 0o700 })
const repo = process.cwd()
const require = createRequire(import.meta.url)
const asar = require('@electron/asar')
const builderRequire = createRequire(require.resolve('electron-builder/package.json'))
const tools = await builderRequire('app-builder-lib/out/toolsets/linux.js').getAppImageTools(
  '1.0.3',
  builderRequire('builder-util').Arch.x64
)
const extracted = spawnSync(path.resolve(baseImage), ['--appimage-extract'], {
  cwd: root,
  stdio: 'ignore',
  timeout: 60_000
})
if (extracted.status !== 0) {
  throw new Error('Base AppImage extraction failed')
}
const appdir = path.join(root, 'squashfs-root')
const source = path.join(root, 'app-source')
asar.extractAll(path.join(appdir, 'resources/app.asar'), source)
await cp(path.join(repo, 'out/main'), path.join(source, 'out/main'), { recursive: true })
await cp(path.join(repo, 'out/preload'), path.join(source, 'out/preload'), { recursive: true })
await cp(path.join(repo, 'out/main'), path.join(appdir, 'resources/app.asar.unpacked/out/main'), {
  recursive: true
})
const chunks = path.join(source, 'out/main/chunks')
const runtime = (await readdir(path.join(repo, 'out/main/chunks'))).find((file) =>
  /^home-appimage-runtime.*\.js$/.test(file)
)
if (!runtime) {
  throw new Error('Build the main bundle before packaging fixtures')
}
let text = await readFile(path.join(chunks, runtime), 'utf8')
const anchor = /fetch:\(e,t\)=>r\.net\.fetch\(e,t\)/
if (!anchor.test(text)) {
  throw new Error('Fixture transport anchor changed')
}
// Test artifacts change only release transport and package version; production has no fixture endpoint.
text = text.replace(
  anchor,
  'fetch:(e,t)=>r.net.fetch("http://127.0.0.1:"+process.env.ORCA_HOME_UPDATE_FIXTURE_PORT+(e.includes("api.github.com")?"/releases":"/"+e.split("/").pop()),t)'
)
await writeFile(path.join(chunks, runtime), text)
for (const suffix of [0, 1]) {
  const pkgFile = path.join(source, 'package.json')
  const pkg = JSON.parse(await readFile(pkgFile, 'utf8'))
  pkg.version = `1.4.224-${suffix}`
  await writeFile(pkgFile, JSON.stringify(pkg))
  await rm(path.join(appdir, 'resources/app.asar'))
  await asar.createPackage(source, path.join(appdir, 'resources/app.asar'))
  const squash = path.join(root, `fixture-${suffix}.squashfs`)
  const result = spawnSync(
    tools.mksquashfs,
    [appdir, squash, '-noappend', '-comp', 'zstd', '-Xcompression-level', '3', '-processors', '1'],
    { stdio: 'inherit', timeout: 120_000 }
  )
  if (result.status !== 0) {
    throw new Error(`mksquashfs exit ${result.status}`)
  }
  const image = path.join(root, `fixture-${suffix}.AppImage`)
  await pipeline(createReadStream(tools.runtime), createWriteStream(image, { flags: 'wx' }))
  await pipeline(createReadStream(squash), createWriteStream(image, { flags: 'a' }))
  await chmod(image, 0o755)
  await rm(squash)
  console.log(`Fixture: ${image}`)
}
