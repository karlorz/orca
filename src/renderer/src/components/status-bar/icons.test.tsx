import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { GrokIcon, MiniMaxIcon } from './icons'

describe('GrokIcon', () => {
  it('renders the grok.com orbit-slash as a currentColor SVG', () => {
    const markup = renderToStaticMarkup(<GrokIcon size={14} />)
    expect(markup.startsWith('<svg')).toBe(true)
    expect(markup).toContain('viewBox="0 0 24 24"')
    expect(markup).toContain('fill="currentColor"')
    expect(markup).toContain('width="14"')
    expect(markup).not.toContain('agent-icons/grok.png')
    expect(markup).not.toContain('x.ai')
  })
})

describe('MiniMaxIcon', () => {
  it('renders the official MiniMax mark as an image', () => {
    const markup = renderToStaticMarkup(<MiniMaxIcon size={14} />)
    expect(markup.startsWith('<img')).toBe(true)
    expect(markup).toContain('aria-hidden="true"')
    expect(markup).toContain('width="14"')
    expect(markup).toContain('height="14"')
  })

  it('honors a custom size prop', () => {
    const markup = renderToStaticMarkup(<MiniMaxIcon size={20} />)
    expect(markup).toContain('width="20"')
    expect(markup).toContain('height="20"')
  })

  it('does not render the legacy "M" placeholder text', () => {
    const markup = renderToStaticMarkup(<MiniMaxIcon size={14} />)
    expect(markup).not.toContain('>M<')
  })
})
