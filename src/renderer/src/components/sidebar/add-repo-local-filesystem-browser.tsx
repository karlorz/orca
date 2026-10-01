import { useCallback, useState, type JSX } from 'react'
import type { AddRepoExistingWorkspaceSource } from '../../../../shared/telemetry-events'
import { CreateProjectParentBrowser } from './CreateProjectLocationField'
import { shouldUseInAppLocalFolderPicker } from './should-use-in-app-local-folder-picker'

export function useAddRepoLocalFilesystemBrowse({
  handleBrowse,
  handleAddLocalPath,
  initialPath
}: {
  handleBrowse: () => Promise<void>
  handleAddLocalPath: (path: string, source: AddRepoExistingWorkspaceSource) => Promise<unknown>
  initialPath: string
}): {
  browsingLocal: boolean
  browseLocal: () => void
  stopBrowsingLocal: () => void
  panel: JSX.Element | null
} {
  const [browsingLocal, setBrowsingLocal] = useState(false)
  const stopBrowsingLocal = useCallback(() => setBrowsingLocal(false), [])
  const browseLocal = useCallback((): void => {
    if (shouldUseInAppLocalFolderPicker()) {
      setBrowsingLocal(true)
      return
    }
    void handleBrowse()
  }, [handleBrowse])
  const panel = browsingLocal ? (
    <CreateProjectParentBrowser
      local
      createParent={initialPath}
      onParentChange={(path) => {
        setBrowsingLocal(false)
        void handleAddLocalPath(path, 'local_folder_picker')
      }}
      onClose={stopBrowsingLocal}
    />
  ) : null
  return { browsingLocal, browseLocal, stopBrowsingLocal, panel }
}
