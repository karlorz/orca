import type { OwnMobileRelayOperatorConfig } from './own-mobile-relay-types'

export const TEST_OPERATOR: OwnMobileRelayOperatorConfig = {
  email: 'test-operator@example.com',
  password: 'test-operator-password-xyz-123',
  userId: 'user-test-op-1',
  profileId: 'prof-test-op-1',
  organizationId: 'org-test-op-1'
}

export const TEST_CLIENT_ID = 'orca-desktop'

export async function loginAndObtainSessionToken(
  serverOrigin: string,
  operator: OwnMobileRelayOperatorConfig = TEST_OPERATOR,
  clientId: string = TEST_CLIENT_ID,
  localProfileId?: string
): Promise<string> {
  const verifier = 'test-auth-helper-verifier-string-12345678901234567890'
  const challenge = Buffer.from(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  ).toString('base64url')

  const queryParams = new URLSearchParams({
    client_id: clientId,
    redirect_uri: 'http://127.0.0.1:4000/auth/callback',
    code_challenge_method: 'S256',
    code_challenge: challenge,
    response_type: 'code',
    state: 'test-state',
    nonce: 'test-nonce',
    ...(localProfileId ? { local_profile_id: localProfileId } : {})
  })

  const loginRes = await fetch(
    `${serverOrigin}/v1/desktop/auth/authorize?${queryParams.toString()}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        email: operator.email,
        password: operator.password
      }).toString(),
      redirect: 'manual'
    }
  )

  const location = new URL(loginRes.headers.get('location')!)
  const code = location.searchParams.get('code')!

  const sessionRes = await fetch(`${serverOrigin}/v1/desktop/auth/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      code,
      codeVerifier: verifier,
      nonce: 'test-nonce',
      redirectUri: 'http://127.0.0.1:4000/auth/callback',
      state: 'test-state',
      localProfileId
    })
  })

  const session = (await sessionRes.json()) as { accessToken: string }
  return session.accessToken
}
