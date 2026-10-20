import path from 'node:path'
import {
  appImageNamespaceKey,
  readAppImageSourceOfNamespace,
  resolveAppImageGenerationOfExecutable
} from '../shared/appimage-cache-identity'

type HomeAppImageInput = {
  platform: string
  architecture?: string
  packageType: string
  managed: string | undefined
  appImagePath: string | undefined
  homeDirectory: string
}

/** Only the managed home image uses the shared pin-preserving updater. */
export function isEnsureManagedHomeAppImage(input: HomeAppImageInput): boolean {
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

/** Cached desktop launches can lose the launcher's opt-in and AppImage environment. */
export function resolveEnsureManagedHomeAppImage(
  input: HomeAppImageInput & { execPath: string }
): string | null {
  if (isEnsureManagedHomeAppImage(input)) {
    return input.appImagePath ?? null
  }
  if (
    input.platform !== 'linux' ||
    (input.architecture !== undefined && input.architecture !== 'x64') ||
    input.packageType !== 'non-root' ||
    (input.managed !== undefined && input.managed !== '1')
  ) {
    return null
  }
  const generation = resolveAppImageGenerationOfExecutable(input.execPath)
  if (!generation) {
    return null
  }
  const source = readAppImageSourceOfNamespace(generation.cacheRootPath, generation.namespaceKey)
  const defaultImage = path.join(
    input.homeDirectory,
    '.local',
    'opt',
    'orca',
    'orca-linux.AppImage'
  )
  // Only the canonical home install may recover a missing opt-in from its cache namespace.
  const image =
    source ?? (generation.namespaceKey === appImageNamespaceKey(defaultImage) ? defaultImage : null)
  if (!image || (input.managed !== '1' && image !== defaultImage)) {
    return null
  }
  if (input.appImagePath && input.appImagePath !== image) {
    return null
  }
  return isEnsureManagedHomeAppImage({ ...input, managed: '1', appImagePath: image }) ? image : null
}
