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
