import { isLoopbackCallbackUri } from './own-mobile-relay-auth-store'

export function validateAuthorizeParams(
  url: URL,
  configuredClientId: string
): {
  valid: boolean
  clientId: string
  redirectUri: string
  codeChallenge: string
  codeChallengeMethod: string
  state?: string
  nonce?: string
  localProfileId?: string
} {
  const clientId = url.searchParams.get('client_id') ?? ''
  const redirectUri = url.searchParams.get('redirect_uri') ?? ''
  const codeChallenge = url.searchParams.get('code_challenge') ?? ''
  const codeChallengeMethod = url.searchParams.get('code_challenge_method') ?? ''
  const state = url.searchParams.get('state') ?? undefined
  const nonce = url.searchParams.get('nonce') ?? undefined
  const localProfileId = url.searchParams.get('local_profile_id') ?? undefined

  if (
    clientId !== configuredClientId ||
    !isLoopbackCallbackUri(redirectUri) ||
    codeChallengeMethod !== 'S256' ||
    !codeChallenge
  ) {
    return {
      valid: false,
      clientId,
      redirectUri,
      codeChallenge,
      codeChallengeMethod,
      state,
      nonce,
      localProfileId
    }
  }

  return {
    valid: true,
    clientId,
    redirectUri,
    codeChallenge,
    codeChallengeMethod,
    state,
    nonce,
    localProfileId
  }
}

export function renderLoginForm(actionUrl: string): string {
  return `<!DOCTYPE html>
<html>
<head><title>Sign in for Relay</title></head>
<body>
  <form method="POST" action="${actionUrl}">
    <label>Email: <input type="email" name="email" required /></label>
    <label>Password: <input type="password" name="password" required /></label>
    <button type="submit">Sign In</button>
  </form>
</body>
</html>`
}
