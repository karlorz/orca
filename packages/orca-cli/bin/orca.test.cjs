const { strict: assert } = require('node:assert')
const { chmodSync, copyFileSync, mkdtempSync, mkdirSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { spawnSync } = require('node:child_process')

if (process.platform === 'win32') {
  process.exit(0)
}

const root = mkdtempSync(join(tmpdir(), 'orca-npm-launcher-'))
const bin = join(root, 'bin')
mkdirSync(bin)
const launcher = join(bin, 'orca')
copyFileSync(join(__dirname, 'orca.cjs'), launcher)
chmodSync(launcher, 0o755)
const target = join(bin, 'orca-ide')
writeFileSync(target, '#!/bin/sh\nprintf "target:%s\\n" "$*"\n')
chmodSync(target, 0o755)

const result = spawnSync(process.execPath, [launcher, 'status', '--json'], {
  encoding: 'utf8',
  env: { ...process.env, PATH: bin }
})
assert.equal(result.status, 0)
assert.equal(result.stdout, 'target:status --json\n')
