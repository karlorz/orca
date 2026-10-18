import type { SecurityStateAccountIdentity } from './own-mobile-relay-security-state'
import { escapeHtml, layout } from './own-mobile-relay-admin-pages'

export function renderAdminUsers(
  accounts: SecurityStateAccountIdentity[],
  currentAdminAccountId: string,
  error?: string
): string {
  const err = error
    ? `<p role="alert" style="color:#b91c1c;margin-bottom:12px">${escapeHtml(error)}</p>`
    : ''

  const rows = accounts
    .map((acc) => {
      const isSelf = acc.accountId === currentAdminAccountId
      const isInvited = acc.status === 'invited'
      const isActive = acc.status === 'active'
      const isDisabled = acc.status === 'disabled'

      let actions = ''
      if (isInvited) {
        actions = `<form method="post" action="/admin/users/${encodeURIComponent(acc.accountId)}/activate" style="display:inline-flex;gap:4px;align-items:center">
<input type="password" name="password" placeholder="Set password" required style="width:120px;font-size:12px;padding:2px 4px">
<button type="submit">Activate</button>
</form>`
      } else if (isActive) {
        const resetForm = `<form method="post" action="/admin/users/${encodeURIComponent(acc.accountId)}/reset" style="display:inline-flex;gap:4px;align-items:center">
<input type="password" name="password" placeholder="New password" required style="width:120px;font-size:12px;padding:2px 4px">
<button type="submit">Reset</button>
</form>`
        const disableForm = isSelf
          ? ''
          : `<form method="post" action="/admin/users/${encodeURIComponent(acc.accountId)}/disable" style="display:inline;margin-left:6px">
<button type="submit">Disable</button>
</form>`
        actions = `${resetForm}${disableForm}`
      } else if (isDisabled) {
        actions = '<span style="color:#64748b;font-size:12px">Disabled</span>'
      }

      const roleBadge =
        acc.role === 'admin'
          ? ' <span style="background:#e0e7ff;color:#3730a3;padding:1px 5px;border-radius:4px;font-size:11px">admin</span>'
          : ' <span style="background:#f1f5f9;color:#475569;padding:1px 5px;border-radius:4px;font-size:11px">user</span>'

      const statusBadge = isInvited
        ? '<span style="background:#fef3c7;color:#92400e;padding:1px 5px;border-radius:4px;font-size:11px">invited</span>'
        : isActive
          ? '<span style="background:#dcfce7;color:#166534;padding:1px 5px;border-radius:4px;font-size:11px">active</span>'
          : '<span style="background:#fee2e2;color:#991b1b;padding:1px 5px;border-radius:4px;font-size:11px">disabled</span>'

      const selfTag = isSelf
        ? ' <span style="background:#f1f5f9;padding:1px 5px;border-radius:4px;font-size:10px;color:#0f172a">you</span>'
        : ''

      return `<tr>
<td>${escapeHtml(acc.email)}${selfTag}</td>
<td>${roleBadge}</td>
<td>${statusBadge}</td>
<td>${actions}</td>
</tr>`
    })
    .join('')

  const body = `<h1>Users</h1>
${err}
<div style="margin-bottom:20px;padding:12px;background:#f8fafc;border:1px solid #cbd5e1;border-radius:6px;max-width:480px">
  <h2 style="font-size:14px;margin:0 0 8px">Invite new user</h2>
  <form method="post" action="/admin/users/invite" style="display:flex;gap:8px">
    <input type="email" name="email" placeholder="user@example.com" required style="flex:1;padding:4px 8px;font-size:13px">
    <button type="submit">Invite</button>
  </form>
</div>
<table>
<tr><th>Email</th><th>Role</th><th>Status</th><th>Actions</th></tr>
${rows}
</table>`

  return layout('Relay operator users', body)
}
