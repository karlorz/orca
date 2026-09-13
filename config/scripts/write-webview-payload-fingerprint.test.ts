import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { it } from 'vitest'

it.skipIf(!process.env.WEBVIEW_FINGERPRINT_OUT)(
  'writes the composed WebView payload fingerprint for fork-sync',
  async () => {
    const out = process.env.WEBVIEW_FINGERPRINT_OUT
    const { XTERM_HTML } = await import('../../mobile/src/terminal/terminal-webview-html')
    writeFileSync(
      out,
      `${JSON.stringify({
        length: XTERM_HTML.length,
        sha256: createHash('sha256').update(XTERM_HTML, 'utf8').digest('hex')
      })}\n`
    )
  }
)
