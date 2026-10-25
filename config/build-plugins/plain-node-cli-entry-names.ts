// The CLI loads these paths after electron-vite replaces out/main.
export const CLI_MAIN_ENTRY_NAMES = [
  'agent-hooks/managed-agent-hook-controls',
  'daemon/daemon-pid-file-parse',
  'gitlab/project-ref-parser',
  'home-appimage-release-policy',
  'home-appimage-updater',
  'linux-home-update-policy',
  'orca-home-appimage-install',
  'orca-home-appimage-verification',
  'orca-profiles/profile-index-store',
  'claude-accounts/keychain',
  'skills/bundled-skill-install/cli-entry',
  'macos-tree-clone',
  'orcad/orcad-stale-lock-reclaim',
  ...[
    'access',
    'active-location',
    'storage-classification',
    'offline-settings',
    'backup-path',
    'database-recovery',
    'domain-reader',
    'recovery-command'
  ].map((module) => `persistence/profile-state/profile-state-${module}`),
  'persistence/profile-state/legacy-json/profile-state-export-path',
  'persistence/profile-state/legacy-json/profile-state-recovery',
  'startup/http1-compatibility-marker'
] as const
