import { describe, expect, it } from 'vitest'
import { resolveHostEndpointEdit } from './host-endpoint-edit'
import {
  isLocalPlaintextHost,
  PLAINTEXT_BARE_HOST_ERROR,
  PLAINTEXT_HOST_ERROR,
  plaintextHostError
} from './plaintext-host-policy'

describe('isLocalPlaintextHost', () => {
  it.each([
    ['10.0.0.5'],
    ['10.0.2.2'],
    ['172.16.0.1'],
    ['172.31.255.255'],
    ['192.168.1.10'],
    ['127.0.0.1'],
    ['169.254.10.20'],
    ['localhost'],
    ['desk.local'],
    ['DESK.LOCAL.'],
    ['::1'],
    ['[::1]'],
    ['fe80::1'],
    ['fd12:3456::1'],
    ['100.64.0.1'],
    ['100.101.102.103'],
    ['100.127.255.255'],
    ['desk.tail1234.ts.net'],
    ['DESK.TAIL1234.TS.NET']
  ])('allows %p', (host) => {
    expect(isLocalPlaintextHost(host)).toBe(true)
  })

  it.each([
    ['8.8.8.8'],
    ['172.15.0.1'],
    ['172.32.0.1'],
    ['192.169.1.1'],
    ['100.63.255.255'],
    ['100.128.0.1'],
    ['desk.example.com'],
    ['ts.net.example.com'],
    ['notts.net'],
    ['local.example.com'],
    ['desk'],
    ['2001:db8::1']
  ])('rejects %p', (host) => {
    expect(isLocalPlaintextHost(host)).toBe(false)
  })
})

describe('Edit host plaintext rule', () => {
  it('accepts a new ws:// LAN address', () => {
    expect(resolveHostEndpointEdit('ws://192.168.1.10:6768', '192.168.1.20')).toEqual({
      kind: 'changed',
      endpoint: 'ws://192.168.1.20:6768'
    })
  })

  it('rejects a new ws:// public address', () => {
    expect(resolveHostEndpointEdit('ws://192.168.1.10:6768', 'ws://desk.example.com:6768')).toEqual(
      { kind: 'invalid', error: PLAINTEXT_HOST_ERROR }
    )
  })

  it('still allows a public host over wss://', () => {
    expect(resolveHostEndpointEdit('ws://192.168.1.10:6768', 'wss://desk.example.com')).toEqual({
      kind: 'changed',
      endpoint: 'wss://desk.example.com:443'
    })
  })

  it('leaves an untouched stored public ws:// endpoint alone', () => {
    expect(resolveHostEndpointEdit('ws://203.0.113.5:6768', '203.0.113.5:6768')).toEqual({
      kind: 'unchanged',
      endpoint: 'ws://203.0.113.5:6768'
    })
  })

  it('accepts a new ws:// Tailscale IP', () => {
    expect(resolveHostEndpointEdit('ws://192.168.1.10:6768', '100.101.102.103')).toEqual({
      kind: 'changed',
      endpoint: 'ws://100.101.102.103:6768'
    })
  })

  it('accepts a new ws:// MagicDNS name', () => {
    expect(resolveHostEndpointEdit('ws://192.168.1.10:6768', 'desk.tail1234.ts.net:7777')).toEqual({
      kind: 'changed',
      endpoint: 'ws://desk.tail1234.ts.net:7777'
    })
  })

  it.each([['desk'], ['ws://desk:6768']])(
    'rejects the bare hostname %p, pointing at wss:// or the full name',
    (input) => {
      expect(resolveHostEndpointEdit('ws://192.168.1.10:6768', input)).toEqual({
        kind: 'invalid',
        error: PLAINTEXT_BARE_HOST_ERROR
      })
      expect(PLAINTEXT_BARE_HOST_ERROR).toMatch(/wss:\/\/.*full name/)
    }
  )

  it.each([['8.8.8.8'], ['ws://203.0.113.5:6768'], ['desk.example.com']])(
    'still rejects the public address %p',
    (input) => {
      expect(resolveHostEndpointEdit('ws://192.168.1.10:6768', input)).toEqual({
        kind: 'invalid',
        error: PLAINTEXT_HOST_ERROR
      })
    }
  )

  it('allows a bare hostname over wss://', () => {
    expect(resolveHostEndpointEdit('ws://192.168.1.10:6768', 'wss://desk')).toMatchObject({
      kind: 'changed'
    })
  })
})

describe('plaintextHostError', () => {
  it('distinguishes bare names from public hosts and allows localhost', () => {
    expect(plaintextHostError('desk')).toBe(PLAINTEXT_BARE_HOST_ERROR)
    expect(plaintextHostError('desk.example.com')).toBe(PLAINTEXT_HOST_ERROR)
    expect(plaintextHostError('2001:db8::1')).toBe(PLAINTEXT_HOST_ERROR)
    expect(plaintextHostError('localhost')).toBeNull()
    expect(plaintextHostError('100.100.100.100')).toBeNull()
  })
})
