import path from 'node:path'

/** The home ensure script owns updates only for an identified home AppImage. */
export function isEnsureManagedHomeAppImage(input: {
  platform: string
  packageType: string
  managed: string | undefined
  appImagePath: string | undefined
  homeDirectory: string
}): boolean {
  if (
    input.platform !== 'linux' ||
    input.packageType !== 'non-root' ||
    input.managed !== '1' ||
    !input.appImagePath ||
    input.appImagePath.includes('\0') ||
    !path.isAbsolute(input.appImagePath)
  ) {
    return false
  }
  const relative = path.relative(input.homeDirectory, input.appImagePath)
  return (
    relative.length > 0 &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  )
}

export const HOME_APPIMAGE_UPDATE_MESSAGE =
  'This home installation is pinned by the Orca ensure script. Run install-orca-home-appimage.sh --latest to select a newer release, then restart Orca when your work is saved.'
