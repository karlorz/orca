import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const projectDir = resolve(import.meta.dirname, '../..')
const deployDir = join(projectDir, 'config/docker/own-mobile-relay')
const composePath = join(deployDir, 'docker-compose.coolify.yml')
const dockerfilePath = join(deployDir, 'Dockerfile')
const envExamplePath = join(deployDir, '.env.example')
const workflowPath = join(projectDir, '.github/workflows/fork-own-mobile-relay-image.yml')
const featuresPath = join(projectDir, 'config/fork-features.yml')

const AUTH_HOST = 'orca-auth.karldigi.dev'
const RELAY_HOST = 'orca-relay.karldigi.dev'

function readRequired(path) {
  if (!existsSync(path)) {
    throw new Error(`Missing required file: ${path}`)
  }
  return readFileSync(path, 'utf8')
}

function serviceEnvironment(service) {
  const env = service.environment
  if (!env) {
    return {}
  }
  if (Array.isArray(env)) {
    return Object.fromEntries(
      env.map((entry) => {
        const index = entry.indexOf('=')
        return index === -1 ? [entry, ''] : [entry.slice(0, index), entry.slice(index + 1)]
      })
    )
  }
  return env
}

function labelText(service) {
  const labels = service.labels
  if (!labels) {
    return ''
  }
  if (Array.isArray(labels)) {
    return labels.join('\n')
  }
  return Object.entries(labels)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')
}

describe('own-mobile-relay Coolify deploy channel', () => {
  const composeRaw = readRequired(composePath)
  const compose = parse(composeRaw)
  const serviceNames = Object.keys(compose.services ?? {})
  const service = compose.services[serviceNames[0]]

  it('keeps the deploy channel off the repo root so the root-entry guard stays green', () => {
    for (const name of [
      'Dockerfile',
      'docker-compose.coolify.yml',
      '.env.example',
      '.dockerignore'
    ]) {
      expect(existsSync(join(projectDir, name))).toBe(false)
    }
  })

  it('ships docker-compose.coolify.yml with one service, expose 8093, no host ports or profiles', () => {
    expect(serviceNames).toHaveLength(1)
    expect(composeRaw).not.toMatch(/^[\t ]*ports:/m)
    expect(composeRaw).not.toMatch(/^[\t ]*profiles:/m)
    expect(service.ports).toBeUndefined()
    expect(service.profiles).toBeUndefined()
    expect(compose.profiles).toBeUndefined()

    const exposed = (service.expose ?? []).map((value) => String(value))
    expect(exposed).toContain('8093')
  })

  it('labels both public hostnames for HTTP and WebSocket and mounts a named SQLite volume', () => {
    const labels = labelText(service)
    expect(labels).toContain(AUTH_HOST)
    expect(labels).toContain(RELAY_HOST)
    expect(labels).toMatch(/traefik\.http\.routers\./)
    expect(labels).toMatch(/entrypoints=https/i)
    expect(labels).toMatch(/entrypoints=http/i)
    expect(labels).toMatch(/loadbalancer\.server\.port=8093/)

    const volumes = service.volumes ?? []
    const volumeText = volumes.map((value) =>
      typeof value === 'string' ? value : JSON.stringify(value)
    )
    expect(volumeText.some((value) => value.includes('/var/lib/own-mobile-relay'))).toBe(true)
    expect(compose.volumes && Object.keys(compose.volumes).length > 0).toBe(true)
  })

  it('binds 0.0.0.0 in the container and names Coolify env without secrets or operator bootstrap', () => {
    const env = serviceEnvironment(service)
    expect(String(env.OWN_RELAY_LISTEN_HOST)).toBe('0.0.0.0')
    expect(String(env.OWN_RELAY_LISTEN_PORT)).toBe('8093')
    expect(String(env.OWN_RELAY_STATE_PATH)).toContain(
      '/var/lib/own-mobile-relay/security-state.db'
    )

    const example = readRequired(envExamplePath)
    for (const name of [
      'OWN_RELAY_LISTEN_HOST=0.0.0.0',
      'OWN_RELAY_LISTEN_PORT=8093',
      `OWN_RELAY_ORIGIN=https://${RELAY_HOST}`,
      `OWN_RELAY_AUTH_ORIGIN=https://${AUTH_HOST}`,
      'OWN_RELAY_CLIENT_ID=',
      'OWN_RELAY_STATE_PATH=/var/lib/own-mobile-relay/security-state.db'
    ]) {
      expect(example).toContain(name)
    }
    expect(example).not.toMatch(/OWN_RELAY_OPERATOR_/)
    expect(example).not.toMatch(/(PASSWORD|SECRET|TOKEN)=.+/i)
  })

  it('builds a Node 22 non-root image that runs the own-mobile-relay bundle and healthchecks GET /health', () => {
    const dockerfile = readRequired(dockerfilePath)
    expect(dockerfile).toMatch(/FROM node:22/)
    expect(dockerfile).toContain('scripts/build-own-mobile-relay.mjs')
    expect(dockerfile).toContain('dist-own-mobile-relay/own-mobile-relay.cjs')
    expect(dockerfile).toMatch(/^USER (?!root\b)/m)
    expect(dockerfile).toMatch(/HEALTHCHECK/)
    expect(dockerfile).toContain('/health')
    expect(dockerfile).toContain('OWN_RELAY_LISTEN_HOST=0.0.0.0')
    expect(dockerfile).toContain('/var/lib/own-mobile-relay')
  })

  it('publishes a karlorz-only multi-arch image with linux/amd64 required', () => {
    const raw = readRequired(workflowPath)
    expect(raw).toContain("github.repository == 'karlorz/orca'")
    expect(raw).toContain('linux/amd64')
    expect(raw).toContain('ghcr.io/karlorz/own-mobile-relay')
    expect(raw).toMatch(/docker\.io\/karlorz\/own-mobile-relay|DOCKERHUB/)
    expect(raw).not.toContain('stablyai/orca')
    expect(raw).not.toContain('docker compose up')
    expect(raw).toContain('config/docker/own-mobile-relay/Dockerfile')
    expect(raw).toContain('cache-from: type=gha')
  })

  it('records the fork feature inventory row', () => {
    const features = readRequired(featuresPath)
    expect(features).toContain('id: own-mobile-relay-coolify-deploy')
  })
})
