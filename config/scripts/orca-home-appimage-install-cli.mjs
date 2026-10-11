import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  commitHomeAppImage,
  recoverHomeAppImage,
  reconcileHomeAppImage,
  verifyHomeAppImage,
  verifyInstalledHomeAppImage
} from './orca-home-appimage-install.ts'

if (process.platform !== 'linux') {
  throw new Error('Home AppImage installer requires Linux')
}
const run = promisify(execFile)
const extract = async (image, cwd) => {
  for (const resource of [
    'resources/package-type',
    'resources/orcad-template/orcad-template.json'
  ]) {
    await run(image, ['--appimage-extract', resource], {
      cwd,
      timeout: 60_000,
      maxBuffer: 65536
    })
  }
}
const [command, root, stage, tag] = process.argv.slice(2)
try {
  switch (command) {
    case 'verify':
      console.log(await verifyHomeAppImage(root, extract))
      break
    case 'recover':
      await recoverHomeAppImage(root, extract)
      break
    case 'reconcile':
      console.log((await reconcileHomeAppImage(root, undefined, extract)).tag)
      break
    case 'check':
      console.log((await verifyInstalledHomeAppImage(root, extract)).tag)
      break
    case 'commit':
      await commitHomeAppImage(root, stage, tag, extract)
      break
    default:
      throw new Error('Expected verify, recover, reconcile, check or commit')
  }
} catch (error) {
  console.error(`orca-home: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
