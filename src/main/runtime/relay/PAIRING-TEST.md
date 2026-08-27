# Manual Pairing & Relay Security Checklist

This document specifies the manual security verification procedures for the own-mobile-relay service and paired desktop/mobile clients per protocol specification §7.

## Checklist Items

1. **Authentication Gate**
   - [ ] Connecting to `/v1/host/control` without a valid Bearer token fails with HTTP `401 Unauthorized`.
   - [ ] Connecting to `/v1/assign` without a valid Bearer token fails with HTTP `401 Unauthorized`.
   - [ ] Phone connection to `/v1/connect/{relayHostId}` with an invalid credential fails with `relay-hello { ok: false, code: 4401 }` and closes socket with code `4401`.

2. **Invite TTL and Expiration**
   - [ ] Invites have a maximum validity window of 10 minutes.
   - [ ] After 10 minutes (or reaching the maximum 8 failed attempts), phone authentication using the invite token returns `relay-hello { ok: false, code: 4401 }` and closes with `4401`.

3. **Host-Bound Invites**
   - [ ] An invite token generated for `relayHostId_A` cannot be used to authenticate on `/v1/connect/{relayHostId_B}`. Attempting cross-host pairing closes with `4401`.

4. **Host Proof Verification (Ed25519)**
   - [ ] Host control connection requires answering the server's ephemeral challenge with an Ed25519 proof signed by the host's private key.
   - [ ] Tampered proofs or incorrect challenge responses result in immediate socket termination with code `4401`.

5. **Untrusted-Cell & Token Hash Storage**
   - [ ] The relay cell never stores raw resume tokens; it only stores `SHA-256(base64url)` token hashes.
   - [ ] Compromise of the relay database/memory does not allow the adversary to authenticate as a client.

6. **Credential Rotation & Grace Period**
   - [ ] Rotating a resume token via `device-credential-install` shifts the previous token to `grace` status (5-minute window).
   - [ ] Old token resumes within grace return `acceptedAs: 'grace'` on `device-resume-confirm`.

7. **Device Revocation**
   - [ ] Issuing `device-revoke` immediately purges current and grace hashes for the specified device.
   - [ ] Subsequent phone resume attempts with the revoked device's tokens immediately fail with code `4401`.
   - [ ] Subsequent `POST /v1/resolve` lookups with revoked tokens return HTTP `401 Unauthorized`.

8. **LAN Independence**
   - [ ] Phone and desktop operate across distinct network boundaries through the relay without direct LAN connectivity.

9. **Log Redaction & Privacy**
   - [ ] Relay access logs redact sensitive credential parameters, token hashes, and payload contents.
   - [ ] Outer relay framing cannot inspect end-to-end encrypted (E2EE) inner protocol payloads.

10. **No Hardcoded Domains**
    - [ ] No hardcoded references to proprietary external domains (e.g., `*.onorca.dev`) exist in relay connection configuration.

11. **Standalone Deployment & State Authority**
    - [ ] **First Bootstrap Serve**: Run `node own-mobile-relay.cjs serve` (or legacy no-subcommand invocation) with complete one-time bootstrap variables:
      - `OWN_RELAY_STATE_PATH`: Path to SQLite database file.
      - `OWN_RELAY_ORIGIN`: Advertised public Relay origin (e.g. `https://orca-relay.example.com`).
      - `OWN_RELAY_AUTH_ORIGIN`: Distinct auth origin for password change form submissions (e.g. `https://orca-auth.example.com` or identical to Relay origin if unified).
      - `OWN_RELAY_CLIENT_ID`: Configured desktop client ID (e.g. `orca-desktop-prod`).
      - Complete operator credentials (`OWN_RELAY_OPERATOR_EMAIL`, `OWN_RELAY_OPERATOR_PASSWORD`, `OWN_RELAY_OPERATOR_USER_ID`, `OWN_RELAY_OPERATOR_PROFILE_ID`, optional `OWN_RELAY_OPERATOR_ORG_ID`).
    - [ ] **Steady-State Restart**: After first bootstrap, operator credential environment variables are purged from the host environment / systemd unit. The service starts using only state path, origins, client ID, and listen settings.
    - [ ] **Fail-Closed on Consumed Bootstrap**: If any bootstrap operator variable is supplied to an already initialized database, the service immediately fails startup before opening network listeners with `bootstrap_already_complete`.
    - [ ] **Attended CLI Password Management**: Password management is executed via interactive CLI commands requiring a connected TTY:
      - `node own-mobile-relay.cjs account change-password`: Prompts interactively with echo suppression for current password, new password, and confirmation.
      - `node own-mobile-relay.cjs account reset-password`: Prompts interactively with echo suppression for new password and confirmation.
      - Both CLI commands reject password arguments, options, and secret-bearing environment variables.
      - Both CLI commands increment `auth_epoch`, revoking all active desktop sessions and relay grants while preserving mobile device registrations.

12. **Reverse Proxy & Throttle Security Policy**
    - [ ] **Loopback Boundary**: The own-mobile-relay daemon binds exclusively to loopback (`127.0.0.1` / `::1`) behind a local reverse proxy (such as Caddy).
    - [ ] **Untrusted Forwarded Headers**: Forwarded headers (`X-Forwarded-For`, `X-Real-IP`, etc.) are intentionally ignored and untrusted for authentication rate-limiting in the application daemon.
    - [ ] **Dual-Key Throttling**: Authentication throttle enforces rate limits across two distinct buckets: `email` (global per-operator email bucket) and `email+IP` (socket remote IP). When behind a reverse proxy, the `email` bucket enforces strict brute-force protection across all incoming proxy connections, ensuring defense-in-depth regardless of socket remote address.

13. **Test-Stage Disposable Database Reset Procedure**
    - [ ] **Stop Service**: Ensure the relay daemon is completely stopped before any storage reset (`systemctl stop own-mobile-relay` or terminate foreground process).
    - [ ] **Optional Protected Backup**: If needed for offline inspection, create a restricted timestamped backup (`cp security-state.db security-state.db.bak-$(date +%s)` with `0600` permissions).
    - [ ] **Remove DB and Sidecars Together**: Remove the main database along with any WAL, SHM, and journal files (`rm -f security-state.db security-state.db-wal security-state.db-shm security-state.db-journal`).
    - [ ] **Retain Bootstrap Configuration**: Retain the protected bootstrap configuration (`OWN_RELAY_OPERATOR_EMAIL`, `OWN_RELAY_OPERATOR_PASSWORD`, `OWN_RELAY_OPERATOR_USER_ID`, `OWN_RELAY_OPERATOR_PROFILE_ID`) in the environment/unit for test account initialization.
    - [ ] **Start and Verify Health**: Start the service and verify healthy startup (`systemctl start own-mobile-relay` and probe `/v1/health` or loopback port).
    - [ ] **Expect Re-Sign-In / Re-Pair**: Because the database was reset, any prior desktop sessions, grants, and mobile device credentials are gone; perform desktop sign-in and mobile re-pairing.

