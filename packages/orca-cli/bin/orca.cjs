#!/usr/bin/env node

const { existsSync, realpathSync } = require('node:fs')
const { homedir, platform } = require('node:os')
const { delimiter, join } = require('node:path')
const { spawnSync } = require('node:child_process')

function pathCandidates(command) {
  const extensions = platform() === 'win32' ? ['', '.exe', '.cmd'] : ['']
  return (process.env.PATH ?? '')
    .split(delimiter)
    .filter(Boolean)
    .flatMap((directory) =>
      extensions.map((extension) => join(directory, `${command}${extension}`))
    )
}

function packagedCandidates() {
  if (platform() === 'darwin') {
    return [
      '/Applications/Orca.app/Contents/Resources/bin/orca',
      join(homedir(), 'Applications', 'Orca.app', 'Contents', 'Resources', 'bin', 'orca')
    ]
  }
  if (platform() === 'win32') {
    const localAppData = process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local')
    return [join(localAppData, 'Programs', 'Orca', 'resources', 'bin', 'orca.exe')]
  }
  return [
    join(homedir(), '.local', 'bin', 'orca-ide'),
    '/opt/Orca/resources/bin/orca-ide',
    '/opt/orca-ide/resources/bin/orca-ide',
    '/opt/orca/resources/bin/orca-ide'
  ]
}

const ownPath = realpathSync(process.argv[1])
const candidate = [
  ...pathCandidates('orca'),
  ...pathCandidates('orca-ide'),
  ...packagedCandidates()
].find((path) => existsSync(path) && realpathSync(path) !== ownPath)

if (!candidate) {
  console.error(
    'Unable to find the Orca CLI bundled with a desktop installation. Install a karlorz/orca desktop release, then enable Settings → General → Shell command.'
  )
  process.exit(1)
}

const result = spawnSync(candidate, process.argv.slice(2), { stdio: 'inherit', shell: false })
if (result.error) {
  console.error(`Unable to launch ${candidate}: ${result.error.message}`)
  process.exit(1)
}
process.exit(result.status ?? 1)
