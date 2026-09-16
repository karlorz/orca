export function renderStatusHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Orca Fork Live Status</title>
  <style>
    :root {
      --bg: #090d16;
      --card: #131b2e;
      --card-border: #23304e;
      --text-main: #f1f5f9;
      --text-muted: #94a3b8;
      --ok-bg: #052e16;
      --ok-border: #166534;
      --ok-text: #4ade80;
      --err-bg: #450a0a;
      --err-border: #991b1b;
      --err-text: #f87171;
      --badge-bg: #1e293b;
      --badge-text: #cbd5e1;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: var(--bg);
      color: var(--text-main);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      line-height: 1.5;
      padding: 2rem 1rem;
      max-width: 960px;
      margin: 0 auto;
    }
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 2rem;
      border-bottom: 1px solid var(--card-border);
      padding-bottom: 1rem;
    }
    h1 { font-size: 1.5rem; font-weight: 600; letter-spacing: -0.025em; }
    .subtitle { color: var(--text-muted); font-size: 0.875rem; }
    .refresh-bar {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      font-size: 0.8125rem;
      color: var(--text-muted);
    }
    button {
      background: #2563eb;
      color: #ffffff;
      border: none;
      border-radius: 4px;
      padding: 0.35rem 0.75rem;
      font-size: 0.8125rem;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.15s;
    }
    button:hover { background: #1d4ed8; }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    .grid { display: grid; grid-template-columns: 1fr; gap: 1.25rem; }
    .card {
      background: var(--card);
      border: 1px solid var(--card-border);
      border-radius: 8px;
      padding: 1.25rem;
    }
    .card-head {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 1rem;
    }
    .row-title { font-size: 1.125rem; font-weight: 600; }
    .origin-link {
      font-size: 0.8125rem;
      color: #60a5fa;
      text-decoration: none;
      margin-top: 0.15rem;
      display: inline-block;
    }
    .origin-link:hover { text-decoration: underline; }
    .meta-row {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      margin-bottom: 1rem;
      font-size: 0.75rem;
    }
    .pill {
      background: var(--badge-bg);
      color: var(--badge-text);
      padding: 0.2rem 0.5rem;
      border-radius: 4px;
      font-family: ui-monospace, monospace;
    }
    .probes-container {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 0.75rem;
    }
    .probe-item {
      background: #0f172a;
      border: 1px solid #1e293b;
      border-radius: 6px;
      padding: 0.75rem;
      font-size: 0.8125rem;
    }
    .probe-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0.35rem;
    }
    .probe-name { font-weight: 600; font-family: ui-monospace, monospace; }
    .status-badge {
      display: inline-block;
      padding: 0.15rem 0.45rem;
      border-radius: 3px;
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .status-ok { background: var(--ok-bg); border: 1px solid var(--ok-border); color: var(--ok-text); }
    .status-err { background: var(--err-bg); border: 1px solid var(--err-border); color: var(--err-text); }
    .probe-details { color: var(--text-muted); font-size: 0.75rem; }
    .jwks-info { margin-top: 0.35rem; font-size: 0.75rem; }
    .kid-tag {
      display: inline-block;
      background: #1e293b;
      color: #93c5fd;
      padding: 0.1rem 0.35rem;
      border-radius: 3px;
      font-family: ui-monospace, monospace;
      margin-top: 0.25rem;
      margin-right: 0.25rem;
    }
    footer {
      margin-top: 2rem;
      text-align: center;
      font-size: 0.75rem;
      color: var(--text-muted);
    }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>Orca Live Operator Status</h1>
      <div class="subtitle">Loopback Coolify & HTTPS origin monitor</div>
    </div>
    <div class="refresh-bar">
      <span id="last-updated">Updating...</span>
      <button id="refresh-btn" onclick="fetchStatus()">Refresh</button>
    </div>
  </header>

  <main class="grid" id="status-grid">
    <div style="color: var(--text-muted); padding: 2rem; text-align: center;">Loading snapshot...</div>
  </main>

  <footer>
    Read-only operator status. Probing public HTTPS endpoints and Coolify application API.
  </footer>

  <script>
    function escapeHtml(value) {
      return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
    }

    function renderProbe(name, probe, extraHtml = '') {
      const isOk = probe.status === 'ok';
      const badgeClass = isOk ? 'status-ok' : 'status-err';
      const badgeText = isOk ? 'HEALTHY' : 'DEGRADED';
      const latency = probe.latencyMs != null ? probe.latencyMs + 'ms' : '-';
      const code = probe.httpStatus ? 'HTTP ' + probe.httpStatus : (probe.detail || 'Failed');
      return \`
        <div class="probe-item">
          <div class="probe-header">
            <span class="probe-name">\${name}</span>
            <span class="status-badge \${badgeClass}">\${badgeText}</span>
          </div>
          <div class="probe-details">\${code} (\${latency})</div>
          \${extraHtml}
        </div>
      \`;
    }

    function render(data) {
      if (!data || !data.rows) return;
      const grid = document.getElementById('status-grid');
      let html = '';

      for (const row of data.rows) {
        const coolify = row.coolify || {};
        const isCoolifyRunning = typeof coolify.status === 'string' && coolify.status.startsWith('running');
        const coolifyBadgeClass = isCoolifyRunning ? 'status-ok' : 'status-err';
        const coolifyText = coolify.status ? String(coolify.status).toUpperCase() : 'UNKNOWN';

        let probesHtml = '';
        if (row.id === 'own-auth') {
          probesHtml += renderProbe('GET /health', row.probes.health);
          let jwksExtra = '';
          if (row.probes.jwks.keyCount != null) {
            jwksExtra += \`<div class="jwks-info">Keys: <strong>\${row.probes.jwks.keyCount}</strong></div>\`;
          }
          if (row.probes.jwks.kids && row.probes.jwks.kids.length > 0) {
            jwksExtra += \`<div>\${row.probes.jwks.kids.map(k => \`<span class="kid-tag">\${escapeHtml(k)}</span>\`).join('')}</div>\`;
          }
          probesHtml += renderProbe('GET /.well-known/jwks.json', row.probes.jwks, jwksExtra);
        } else if (row.id === 'official-relay') {
          probesHtml += renderProbe('GET /health', row.probes.health);
          probesHtml += renderProbe('GET /ready', row.probes.ready);
        }

        html += \`
          <article class="card">
            <div class="card-head">
              <div>
                <div class="row-title">\${escapeHtml(row.name)}</div>
                <a class="origin-link" href="\${escapeHtml(row.origin)}" target="_blank" rel="noopener noreferrer">\${escapeHtml(row.origin)}</a>
              </div>
              <span class="status-badge \${coolifyBadgeClass}">COOLIFY: \${escapeHtml(coolifyText)}</span>
            </div>
            <div class="meta-row">
              <span class="pill">UUID: \${escapeHtml(row.coolifyUuid)}</span>
              \${coolify.image ? \`<span class="pill">IMAGE: \${escapeHtml(coolify.image)}</span>\` : ''}
              \${coolify.error ? \`<span class="pill" style="color:var(--err-text)">API: \${escapeHtml(coolify.error)}</span>\` : ''}
            </div>
            <div class="probes-container">
              \${probesHtml}
            </div>
          </article>
        \`;
      }

      grid.innerHTML = html;
      document.getElementById('last-updated').textContent = 'Snapshot: ' + new Date(data.timestamp).toLocaleTimeString();
    }

    async function fetchStatus() {
      const btn = document.getElementById('refresh-btn');
      btn.disabled = true;
      btn.textContent = 'Probing...';
      try {
        const res = await fetch('/api/snapshot');
        if (res.ok) {
          render(await res.json());
        } else {
          document.getElementById('last-updated').textContent = 'Probe request failed (' + res.status + ')';
        }
      } catch (err) {
        document.getElementById('last-updated').textContent = 'Probe network error';
      } finally {
        btn.disabled = false;
        btn.textContent = 'Refresh';
      }
    }

    fetchStatus();
  </script>
</body>
</html>`
}
