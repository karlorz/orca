import { describe, expect, it } from 'vitest'
import { resolvePushGatewayOrigin } from './push-gateway-origin'

describe('resolvePushGatewayOrigin', () => {
  it('uses env origin when unpackaged', () => {
    expect(
      resolvePushGatewayOrigin({ ORCA_PUSH_GATEWAY_URL: 'https://push.example.dev' }, false)
    ).toBe('https://push.example.dev')
  })

  it('uses env origin when packaged', () => {
    expect(
      resolvePushGatewayOrigin({ ORCA_PUSH_GATEWAY_URL: 'https://push.example.dev' }, true)
    ).toBe('https://push.example.dev')
  })

  it('uses overlay when packaged and no env', () => {
    expect(resolvePushGatewayOrigin({}, true, 'https://orca-push.karldigi.dev')).toBe(
      'https://orca-push.karldigi.dev'
    )
  })

  it('uses default when packaged, no env, and overlay is undefined or empty', () => {
    expect(resolvePushGatewayOrigin({}, true, undefined)).toBe('https://push.onorca.dev')
    expect(resolvePushGatewayOrigin({}, true, '')).toBe('https://push.onorca.dev')
  })

  it('ignores invalid http env when packaged and uses overlay or default', () => {
    expect(
      resolvePushGatewayOrigin(
        { ORCA_PUSH_GATEWAY_URL: 'http://evil.example' },
        true,
        'https://orca-push.karldigi.dev'
      )
    ).toBe('https://orca-push.karldigi.dev')

    expect(resolvePushGatewayOrigin({ ORCA_PUSH_GATEWAY_URL: 'http://evil.example' }, true)).toBe(
      'https://push.onorca.dev'
    )
  })
})
