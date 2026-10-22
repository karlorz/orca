import type { OrcadDeployOptions } from './orcad-remote-deploy'
import { getRemoteHostPlatform } from './ssh-remote-platform'

export function options(overrides: Partial<OrcadDeployOptions> = {}): OrcadDeployOptions {
  const census = overrides.census ?? {
    liveSessions: 0,
    startedSinceActivation: 0,
    daemonProtocolVersion: 3
  }
  return {
    conn: Object.create(null),
    host: getRemoteHostPlatform('linux-x64'),
    remoteHome: '/home/u',
    localOrcadDir: '/local/out/orcad',
    target: 'linux-x64-glibc',
    nodePath: '/usr/bin/node',
    userDataDir: '/home/u/.orca',
    bindHost: '127.0.0.1',
    port: 7777,
    census,
    // An unchanged recount unless a test opens a terminal during the upload.
    recountCensus: async () => census,
    releaseIncumbentAdmission: async () => {},
    readinessTimeoutMs: 50,
    sleep: async () => {},
    now: () => new Date('2026-02-02T00:00:00.000Z'),
    ...overrides
  }
}
