import path from 'node:path'

/** Only the managed home image uses the shared pin-preserving updater. */
export function isEnsureManagedHomeAppImage(input: {
  platform: string
  architecture?: string
  packageType: string
  managed: string | undefined
  appImagePath: string | undefined
  homeDirectory: string
}): boolean {
  if (
    input.platform !== 'linux' ||
    (input.architecture !== undefined && input.architecture !== 'x64') ||
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
    path.basename(input.appImagePath) === 'orca-linux.AppImage' &&
    relative.length > 0 &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  )
}
