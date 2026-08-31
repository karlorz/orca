# Own-mobile Relay key expiry and machine trust

How personal-operator own-mobile Relay manages machine admission, token persistence, and revocation without forcing routine interactive re-authentication.

## Context and problem

In upstream Orca Cloud Relay, access tokens and grants expire on wall-clock deadlines (typically 1 hour), requiring repeated sign-in or interactive OAuth refresh. For personal-operator self-hosted deployments, forcing recurring re-authentication on trusted personal hardware (a developer's primary desktop or phone) causes reconnection drops across restarts or idle windows, degrades mobile terminal responsiveness, and introduces friction without adding security against active threats.

At the same time, long-lived access must not degrade into unhashed plaintext bearer tokens or remove the operator's ability to immediately evict compromised devices or rotated credentials.

## Accepted decision

1. **Key expiry defaults to disabled for hosts and paired devices.**
   Personal desktop hosts and paired mobile devices operate as trusted machines by default. Their Relay admission (`keyExpiryDisabled = true`) ignores wall-clock expiration on grants and refresh tokens during normal reconnects.
2. **Durable hashed refresh and admission.**
   The director persists only cryptographic hashes of refresh tokens and device resume credentials in durable SQLite storage (`tokenHash`, `resumeTokenHash`, `graceResumeTokenHash`). Raw token secrets are never persisted in plaintext.
3. **Safe Storage fail-closed in packaged builds.**
   Packaged desktop builds require OS Safe Storage (`safeStorage.isEncryptionAvailable()`) for credential persistence. If Safe Storage is unavailable, desktop sign-in fails closed rather than silently falling back to insecure plaintext disk persistence or ephemeral memory-only storage that would lose connection on restart.
4. **Immediate revocation mechanisms remain authoritative.**
   Disabling wall-clock expiry does not make machine trust permanent or irrevocable. Immediate revocation occurs under any of the following:
   - **Explicit logout**: Revokes the active access session and all associated refresh tokens.
   - **Password change / auth-epoch bump**: Increments `authEpoch`, immediately invalidating all active sessions, grants, and refresh tokens across all hosts.
   - **Operator action**: The operator can explicitly revoke individual devices or grants via `/admin/pairing` or operator API routes.
   - **Re-enabling key expiry**: The operator can toggle key expiry back on (`Enable key expiry`) per host or per device, restoring standard wall-clock expiration.
