# Own-mobile Relay

Account-gated NAT path between Orca desktop and Orca Mobile on a self-hosted director/cell. Payloads stay end-to-end encrypted; this context is admission and machine trust only.

## Language

**Access session**:
Short-lived hashed proof that this desktop completed own-auth.
_Avoid_: Orca Cloud login (Stably), Claude/Codex account

**Refresh token**:
Rotator that mints a new access session without a browser PKCE. The server stores only the hash. When key expiry is disabled, it has no wall-clock expiry.
_Avoid_: session cookie, remember-me, year-long raw bearer

**Key expiry**:
Wall-clock lifetime of a trusted machine’s Relay admission (desktop host or phone). Disabled means that machine never needs to reauthenticate until logout, password/epoch, revoke, or Enable key expiry.
_Avoid_: access-session TTL, Tailscale node key (analog only), immortal WebSocket

**Trusted machine**:
A desktop host or phone whose key expiry is disabled.
_Avoid_: Orca Cloud account, Stably PropelAuth user

**Relay grant**:
One-hour host-control admission tied to a live access session; reminted on desktop start. Wall-clock is ignored while host key expiry is disabled.
_Avoid_: trusted-device pairing (that is the phone device credential)

**Host-control**:
Live WebSocket registration of this desktop on the cell. Dies when Orca is not running; restored after silent refresh.
_Avoid_: persisted socket, SSH src/relay/ daemon

**Device credential**:
Phone resume identity (current/grace hashes). Survives desktop Sign-in and password change.
_Avoid_: access session, grant

**Reconnect-required**:
UI state when the profile is cloud-linked but no usable encrypted session exists. Must not appear after a normal Mac/Orca restart when this host’s key expiry is disabled.

## Decision record

- [Key expiry and machine trust](docs/reference/own-mobile-relay-key-expiry.md): Personal-operator defaults, durable hashed admission, and revocation mechanics.
