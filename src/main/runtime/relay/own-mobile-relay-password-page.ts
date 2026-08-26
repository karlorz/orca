export type PasswordPageFeedback = {
  status?: 'success' | 'error'
  message?: string
}

export const PASSWORD_PAGE_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store, no-cache, must-revalidate',
  pragma: 'no-cache',
  'x-frame-options': 'DENY',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'content-security-policy':
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function renderPasswordChangePage(feedback?: PasswordPageFeedback): string {
  let feedbackHtml = ''
  if (feedback?.message) {
    const isSuccess = feedback.status === 'success'
    const color = isSuccess ? '#15803d' : '#b91c1c'
    const bg = isSuccess ? '#f0fdf4' : '#fef2f2'
    const border = isSuccess ? '#bbf7d0' : '#fecaca'
    feedbackHtml = `<div role="alert" style="background:${bg};color:${color};border:1px solid ${border};padding:12px;border-radius:6px;margin-bottom:16px;font-size:14px;">${escapeHtml(feedback.message)}</div>`
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Change Password - Relay</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #f8fafc; color: #0f172a; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 16px; }
    .card { background: #ffffff; width: 100%; max-width: 400px; padding: 24px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1), 0 1px 2px rgba(0,0,0,0.06); border: 1px solid #e2e8f0; }
    h1 { font-size: 20px; font-weight: 600; margin-bottom: 8px; }
    p.subtitle { font-size: 14px; color: #64748b; margin-bottom: 20px; }
    .field { margin-bottom: 16px; }
    label { display: block; font-size: 14px; font-weight: 500; margin-bottom: 6px; }
    input[type="email"], input[type="password"] { width: 100%; height: 38px; padding: 8px 12px; font-size: 14px; border: 1px solid #cbd5e1; border-radius: 6px; outline: none; transition: border-color 0.15s; }
    input[type="email"]:focus, input[type="password"]:focus { border-color: #3b82f6; box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2); }
    button[type="submit"] { width: 100%; height: 40px; background: #0f172a; color: #ffffff; font-size: 14px; font-weight: 500; border: none; border-radius: 6px; cursor: pointer; transition: background 0.15s; margin-top: 8px; }
    button[type="submit"]:hover { background: #1e293b; }
    .help-text { font-size: 12px; color: #64748b; margin-top: 4px; }
  </style>
</head>
<body>
  <main class="card">
    <h1>Change Relay Password</h1>
    <p class="subtitle">Update account password and invalidate active desktop sessions.</p>
    ${feedbackHtml}
    <form method="POST" action="/v1/desktop/auth/password" autocomplete="off">
      <div class="field">
        <label for="email">Account Email</label>
        <input type="email" id="email" name="email" required autocomplete="email" />
      </div>
      <div class="field">
        <label for="currentPassword">Current Password</label>
        <input type="password" id="currentPassword" name="currentPassword" required autocomplete="current-password" />
      </div>
      <div class="field">
        <label for="newPassword">New Password</label>
        <input type="password" id="newPassword" name="newPassword" required minlength="14" autocomplete="new-password" />
        <div class="help-text">Must be at least 14 characters.</div>
      </div>
      <div class="field">
        <label for="confirmPassword">Confirm New Password</label>
        <input type="password" id="confirmPassword" name="confirmPassword" required minlength="14" autocomplete="new-password" />
      </div>
      <button type="submit">Update Password</button>
    </form>
  </main>
</body>
</html>`
}
