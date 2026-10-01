import { RuntimeServerEnvironmentCommands } from '../../runtime/runtime-server-environment-commands'

const localDirectoryBrowser = new RuntimeServerEnvironmentCommands()

export function browseLocalDirectory(dirPath: string) {
  return localDirectoryBrowser.browseDirectory(dirPath)
}
