import { BrowserWindow, net } from 'electron'
import { getOrcaCloudAuthConfig } from '../../orca-profiles/profile-cloud-auth-config'
import { readFreshOrcaCloudSession } from '../../orca-profiles/profile-cloud-session-refresh'
import { ensureActiveOrcaProfile } from '../../orca-profiles/profile-index-store'
import type { electronHttpClient } from '../../host/electron-http-client'

export type DesktopPasswordPageHandoffResult = { ok: true } | { ok: false; error: string }

export type DesktopPasswordPageHandoffDependencies = {
  fetch?: typeof electronHttpClient.fetch
  getWindow?: () => BrowserWindow | null
  userDataPath: string
  authConfig?: ReturnType<typeof getOrcaCloudAuthConfig>
}

/**
 * Open the own-auth password change page securely within the authenticated Electron session.
 *
 * Requirements (Task 5):
 * 1. Uses Electron net.fetch on session.defaultSession (or BrowserWindow's session) to POST
 *    to `/v1/desktop/auth/password/cookie` with `Authorization: Bearer <accessToken>`.
 * 2. The endpoint returns 204 and sets HttpOnly SameSite=Lax Path=/v1/desktop/auth/password.
 * 3. Navigates/loads the password GET URL in that same session (BrowserWindow), never leaking
 *    tokens into URL queries, hashes, or external browsers (shell.openExternal is forbidden).
 */
export async function openDesktopPasswordPage(
  deps: DesktopPasswordPageHandoffDependencies
): Promise<DesktopPasswordPageHandoffResult> {
  const authConfigResult = deps.authConfig ?? getOrcaCloudAuthConfig()
  if (!authConfigResult.configured) {
    return { ok: false, error: 'cloud_auth_not_configured' }
  }

  const activeProfile = ensureActiveOrcaProfile(deps.userDataPath)
  if (!activeProfile.profile.cloud) {
    return { ok: false, error: 'not_signed_in' }
  }

  const sessionResult = await readFreshOrcaCloudSession(
    authConfigResult.config,
    activeProfile,
    deps.userDataPath
  )

  if (sessionResult.status !== 'found') {
    return { ok: false, error: 'session_unavailable' }
  }

  const accessToken = sessionResult.session.accessToken
  const targetWindow = deps.getWindow
    ? deps.getWindow()
    : (BrowserWindow.getFocusedWindow() ??
      BrowserWindow.getAllWindows().find((w) => !w.isDestroyed()) ??
      null)

  if (!targetWindow || targetWindow.isDestroyed()) {
    return { ok: false, error: 'window_unavailable' }
  }

  const fetchImpl = deps.fetch ?? ((url: string, init?: RequestInit) => net.fetch(url, init))

  const baseUrl = authConfigResult.config.apiBaseUrl.replace(/\/$/, '')
  const cookieEndpoint = `${baseUrl}/v1/desktop/auth/password/cookie`
  const passwordPageUrl = `${baseUrl}/v1/desktop/auth/password`

  try {
    const cookieRes = await fetchImpl(cookieEndpoint, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    })

    if (!cookieRes.ok) {
      return { ok: false, error: `cookie_bootstrap_failed: ${cookieRes.status}` }
    }

    await targetWindow.loadURL(passwordPageUrl)
    return { ok: true }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err)
    }
  }
}
