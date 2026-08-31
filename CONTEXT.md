# Context: Orca Own-Mobile-Relay Security Model

## Glossary

### Access session
A short-lived bearer session (typically 1 hour TTL) issued to an authenticated client (e.g. desktop client) that permits accessing protected endpoints and minting or renewing relay grants.

### Refresh token
A persistent, cryptographically hashed credential used to rotate and mint new access sessions without requiring interactive user password entry. Refresh token raw secrets are never persisted plaintext in the database.

### Key expiry
A security policy governing whether cryptographic credentials and sessions expire based on wall-clock time or remain durable until explicitly revoked or invalidated by an authentication epoch bump.

### Trusted machine
A host device (e.g. personal desktop machine) where key expiry has been disabled by the operator, permitting long-lived automatic session restore across app restarts without interactive re-authentication.

### Relay grant
A scoped, revocable authorization credential bound to a specific relay host (`relayHostId`) and public key, permitting host-control WebSocket connections and session splicing.

### Host-control
The authenticated duplex WebSocket connection between a desktop host and the relay server used for control signaling, heartbeats, and demand-driven connection attachment.

### Device credential
A durable cryptographic resume credential established between a paired client (e.g. mobile phone) and a relay host that enables establishing direct or relay connections without re-pairing.

### Reconnect-required
A client-side state indicating that saved credentials are missing, expired with key expiry enabled, revoked, or invalidated by an epoch bump, requiring the user to interactively sign in again.
