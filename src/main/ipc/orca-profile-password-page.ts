import { BrowserWindow, ipcMain } from 'electron'
import type { OpenDesktopPasswordPageResult } from '../../shared/orca-profiles'
import { getProfileUserDataPath } from '../orca-profiles/profile-storage-paths'
import { openDesktopPasswordPage } from '../runtime/relay/desktop-password-handoff'

export function registerOrcaProfilePasswordPageHandler(): void {
  ipcMain.handle(
    'orcaProfiles:openPasswordPage',
    async (event): Promise<OpenDesktopPasswordPageResult> => {
      const win = BrowserWindow.fromWebContents(event.sender)
      return openDesktopPasswordPage({
        userDataPath: getProfileUserDataPath(),
        getWindow: () => win
      })
    }
  )
}
