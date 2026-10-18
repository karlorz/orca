/** Older systemd units used `serve --serve --serve-port …`; map those onto today's flag names. */
const LEGACY_SERVE_FLAG_ALIASES = [
  ['serve-port', 'port'],
  ['serve-pairing-address', 'pairing-address'],
  ['serve-project-root', 'project-root'],
  ['serve-mobile-pairing', 'mobile-pairing'],
  ['serve-no-pairing', 'no-pairing'],
  ['serve-grant-desktop-control', 'grant-desktop-control'],
  ['serve-recipe-json', 'recipe-json'],
  ['serve-json', 'json']
] as const

export const LEGACY_SERVE_CLI_FLAGS = [
  'serve',
  ...LEGACY_SERVE_FLAG_ALIASES.map(([from]) => from)
] as const

export function applyLegacyServeCliFlagAliases(
  flags: Map<string, string | boolean>
): Map<string, string | boolean> {
  for (const [from, to] of LEGACY_SERVE_FLAG_ALIASES) {
    if (flags.has(from) && !flags.has(to)) {
      const value = flags.get(from)
      if (value !== undefined) {
        flags.set(to, value)
      }
    }
  }
  return flags
}
