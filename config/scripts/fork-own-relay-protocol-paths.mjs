import { existsSync, globSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'

const CONFIG_REL = 'config/fork-own-relay-protocol-paths.yml'

function posix(relPath) {
  return String(relPath ?? '').replaceAll('\\', '/')
}

function globToRegExp(glob) {
  const pattern = posix(glob)
  let out = '^'
  for (let i = 0; i < pattern.length; i += 1) {
    if (pattern.startsWith('**/', i)) {
      out += '(?:.*/)?'
      i += 2
      continue
    }
    if (pattern[i] === '*' && pattern[i + 1] === '*') {
      out += '.*'
      i += 1
      continue
    }
    if (pattern[i] === '*') {
      out += '[^/]*'
      continue
    }
    if (pattern[i] === '?') {
      out += '[^/]'
      continue
    }
    out += pattern[i].replace(/[|\\{}()[\]^$+.]/g, '\\$&')
  }
  out += '$'
  return new RegExp(out)
}

function matchesGlob(relPath, glob) {
  return globToRegExp(glob).test(posix(relPath))
}

export function loadOwnRelayProtocolPathConfig(repoRoot) {
  const path = join(repoRoot, CONFIG_REL)
  if (!existsSync(path)) {
    throw new Error(`Missing ${CONFIG_REL}`)
  }
  const parsed = parse(readFileSync(path, 'utf8'))
  const include = Array.isArray(parsed?.include) ? parsed.include.map(String) : []
  const exclude = Array.isArray(parsed?.exclude) ? parsed.exclude.map(String) : []
  if (include.length === 0) {
    throw new Error(`${CONFIG_REL} include list is empty`)
  }
  if (include.some((glob) => /(^|[^*])relay[^*]*$/.test(glob) && glob === '*relay*')) {
    throw new Error(`${CONFIG_REL} forbids a bare *relay* glob`)
  }
  if (include.includes('*relay*') || include.includes('**/*relay*')) {
    throw new Error(`${CONFIG_REL} forbids a bare *relay* glob`)
  }
  return { include, exclude }
}

export function pathMatchesOwnRelayProtocolAllowlist(relPath, config) {
  const path = posix(relPath)
  if (config.exclude.some((glob) => matchesGlob(path, glob))) {
    return false
  }
  return config.include.some((glob) => matchesGlob(path, glob))
}

export function expandOwnRelayProtocolIncludeGlob(repoRoot, glob) {
  const hits = globSync(glob, { cwd: repoRoot, recursive: true })
  return hits.map(posix)
}

export function staleOwnRelayProtocolIncludeGlobs(repoRoot, config) {
  return config.include.filter(
    (glob) => expandOwnRelayProtocolIncludeGlob(repoRoot, glob).length === 0
  )
}

export function matchingOwnRelayProtocolPaths(relPaths, config) {
  return [...new Set(relPaths.map(posix))].filter((path) =>
    pathMatchesOwnRelayProtocolAllowlist(path, config)
  )
}
