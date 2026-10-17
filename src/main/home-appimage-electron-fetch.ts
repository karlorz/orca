import { session } from 'electron'
import { fetchWithProxyLogin } from './host/electron-proxy-login-fetch'
import {
  HOME_UPDATE_MAX_REDIRECTS,
  assertHomeUpdateUrl,
  type HomeUpdateFetch
} from './home-appimage-release-request'

export const fetchHomeUpdateViaElectron: HomeUpdateFetch = async (url, init) => {
  assertHomeUpdateUrl(url)
  let hops = 0
  return fetchWithProxyLogin(
    new Request(url, { ...init, credentials: 'omit', redirect: 'manual' }),
    session.defaultSession,
    (redirect) => {
      hops += 1
      if (hops > HOME_UPDATE_MAX_REDIRECTS) {
        throw new Error(`Fork update request exceeded the redirect limit ${url}`)
      }
      assertHomeUpdateUrl(redirect.redirectUrl)
      redirect.followRedirect()
    }
  )
}
