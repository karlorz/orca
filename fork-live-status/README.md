# fork-live-status

Tiny read-only Coolify operator status app for own-auth and official-relay.

## Features
- **Loopback only**: Binds strictly to `127.0.0.1` (port 2477 by default).
- **Two targets only**:
  1. `own-auth`: `https://orca-auth.karldigi.dev` (Coolify uuid: `bfxz2ef22nep35ytcv6qqj0t`)
     - Probes: `GET /health`, `GET /.well-known/jwks.json` (key count + kid tags, keys are not dumped).
  2. `official combined`: `https://orca-relay.karldigi.dev` (Coolify uuid: `kl8ypbofi72soo46ha1cr85i`)
     - Probes: `GET /health`, `GET /ready`.
- **Coolify API**: Fetches application status and image dynamically via `GET /api/v1/applications/:uuid`. Bearer token is kept on the server and is never sent to the browser or included in snapshot JSON.
- **Security headers**: CSP, `Cache-Control: no-store`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`.
- **Read-only**: No pairing IDs, no `/admin`, no staging controls, no cutover hold.

## Environment Variables
Configured via environment and validated using Zod:

| Variable | Description | Default |
|---|---|---|
| `PORT` | HTTP listen port | `2477` |
| `COOLIFY_API_URL` | Coolify control panel origin | `https://cp.karldigi.dev` |
| `COOLIFY_API_TOKEN` | Bearer token for Coolify API (optional; Coolify rows error without it) | (empty) |
| `FORK_LIVE_STATUS_AUTH_ORIGIN` | Auth public HTTPS origin | `https://orca-auth.karldigi.dev` |
| `FORK_LIVE_STATUS_RELAY_ORIGIN` | Relay public HTTPS origin | `https://orca-relay.karldigi.dev` |
| `FORK_LIVE_STATUS_AUTH_APP_UUID` | Coolify UUID for own-auth | `bfxz2ef22nep35ytcv6qqj0t` |
| `FORK_LIVE_STATUS_RELAY_APP_UUID` | Coolify UUID for official-relay | `kl8ypbofi72soo46ha1cr85i` |

## Local Development & Testing

Run commands inside `fork-live-status/`:

```bash
# Run unit & integration tests
pnpm test

# Typecheck
pnpm typecheck

# Start without a Coolify token (origin probes still run)
pnpm dev

# Start with a Coolify token
COOLIFY_API_TOKEN="your-token" pnpm dev
```

## Cloud Deployment (e.g. cloud01 over Tailscale)

1. Start the service locally on loopback:
   ```bash
   PORT=2477 COOLIFY_API_TOKEN="..." node dist/index.js
   ```
2. Expose securely via Tailscale Serve without binding to public interfaces:
   ```bash
   tailscale serve --bg 2477
   ```
