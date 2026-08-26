import { describe, expect, it, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync, execSync } from 'node:child_process'
import process from 'node:process'

describe('own-mobile-relay-bundle-pty.test.ts', () => {
  const tempDirs: string[] = []

  afterEach(() => {
    for (const dir of tempDirs) {
      try {
        rmSync(dir, { recursive: true, force: true })
      } catch {
        // ignore
      }
    }
    tempDirs.length = 0
  })

  it('proves PTY interactive password change and reset with echo suppression against real bundle/entry', () => {
    // Check if python3 with pty module is available (macOS / Linux standard)
    const isSupported = process.platform !== 'win32'
    if (!isSupported) {
      // Explicit supported-platform condition
      return
    }

    try {
      execSync('python3 -c "import pty"', { stdio: 'ignore' })
    } catch {
      // Python3 pty not available
      return
    }

    const rootDir = process.cwd()
    const bundlePath = join(rootDir, 'dist-own-mobile-relay', 'own-mobile-relay.cjs')
    // Build bundle if not built
    if (!existsSync(bundlePath)) {
      execSync(`node ${join(rootDir, 'scripts/build-own-mobile-relay.mjs')}`, { stdio: 'pipe' })
    }
    expect(existsSync(bundlePath)).toBe(true)

    const tempDir = mkdtempSync(join(tmpdir(), 'pty-durable-test-'))
    tempDirs.push(tempDir)
    const dbPath = join(tempDir, 'durable-test.db')

    // Python test runner script that allocates a real pseudo-terminal and interacts with the bundle
    const pythonScript = `
import pty, os, sys, subprocess

db_path = sys.argv[1]
bundle_path = sys.argv[2]
node_path = sys.argv[3]

# 1. Bootstrap serve
env = os.environ.copy()
env.update({
    'OWN_RELAY_STATE_PATH': db_path,
    'OWN_RELAY_ORIGIN': 'http://127.0.0.1:8095',
    'OWN_RELAY_AUTH_ORIGIN': 'http://127.0.0.1:8095',
    'OWN_RELAY_CLIENT_ID': 'orca-desktop',
    'OWN_RELAY_LISTEN_HOST': '127.0.0.1',
    'OWN_RELAY_LISTEN_PORT': '8095',
    'OWN_RELAY_OPERATOR_EMAIL': 'operator@example.com',
    'OWN_RELAY_OPERATOR_PASSWORD': 'initial-operator-password-123',
    'OWN_RELAY_OPERATOR_USER_ID': 'user-op-1',
    'OWN_RELAY_OPERATOR_PROFILE_ID': 'prof-op-1'
})

p = subprocess.Popen([node_path, bundle_path, 'serve'], env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
for line in p.stdout:
    if 'Listening on' in line:
        p.terminate()
        break
p.wait()

# 2. PTY change-password test
master, slave = pty.openpty()
clean_env = os.environ.copy()
clean_env['OWN_RELAY_STATE_PATH'] = db_path

proc = subprocess.Popen(
    [node_path, bundle_path, 'account', 'change-password'],
    stdin=slave,
    stdout=slave,
    stderr=slave,
    close_fds=True,
    env=clean_env
)
os.close(slave)

output = b''
stage = 0
while True:
    try:
        data = os.read(master, 1024)
        if not data:
            break
        output += data
        if b'Enter current password:' in output and stage == 0:
            stage = 1
            os.write(master, b'initial-operator-password-123\\n')
        elif b'Enter new password:' in output and stage == 1:
            stage = 2
            os.write(master, b'new-secret-password-xyz999\\n')
        elif b'Confirm new password:' in output and stage == 2:
            stage = 3
            os.write(master, b'new-secret-password-xyz999\\n')
    except OSError:
        break

proc.wait()
os.close(master)

out_str = output.decode('utf-8', errors='ignore')

# Assertions
if 'initial-operator-password-123' in out_str:
    sys.stderr.write('FAILURE: Current password echoed to PTY stdout\\n')
    sys.exit(1)
if 'new-secret-password-xyz999' in out_str:
    sys.stderr.write('FAILURE: New password echoed to PTY stdout\\n')
    sys.exit(1)
if 'Password changed successfully' not in out_str:
    sys.stderr.write('FAILURE: Password change did not complete successfully\\n')
    sys.exit(1)

# 3. PTY reset-password test
master, slave = pty.openpty()
proc2 = subprocess.Popen(
    [node_path, bundle_path, 'account', 'reset-password'],
    stdin=slave,
    stdout=slave,
    stderr=slave,
    close_fds=True,
    env=clean_env
)
os.close(slave)

output2 = b''
stage = 0
while True:
    try:
        data = os.read(master, 1024)
        if not data:
            break
        output2 += data
        if b'Enter new password:' in output2 and stage == 0:
            stage = 1
            os.write(master, b'brand-new-reset-secret-000\\n')
        elif b'Confirm new password:' in output2 and stage == 1:
            stage = 2
            os.write(master, b'brand-new-reset-secret-000\\n')
    except OSError:
        break

proc2.wait()
os.close(master)

out_str2 = output2.decode('utf-8', errors='ignore')

if 'brand-new-reset-secret-000' in out_str2:
    sys.stderr.write('FAILURE: Reset password echoed to PTY stdout\\n')
    sys.exit(1)
if 'Password reset successfully' not in out_str2:
    sys.stderr.write('FAILURE: Password reset did not complete successfully\\n')
    sys.exit(1)

print('PTY_SMOKE_SUCCESS')
`

    const runResult = spawnSync(
      'python3',
      ['-c', pythonScript, dbPath, bundlePath, process.execPath],
      { encoding: 'utf8' }
    )

    if (runResult.status !== 0) {
      throw new Error(`PTY test failed: ${runResult.stderr || runResult.stdout}`)
    }

    expect(runResult.stdout).toContain('PTY_SMOKE_SUCCESS')
    // Guarantee test runner output never contains fixture secrets
    expect(runResult.stdout).not.toContain('initial-operator-password-123')
    expect(runResult.stdout).not.toContain('new-secret-password-xyz999')
    expect(runResult.stdout).not.toContain('brand-new-reset-secret-000')
  })
})
