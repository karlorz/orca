import type { RawData, WebSocket } from 'ws'
import type { OwnMobileRelayBufferedFrame } from './own-mobile-relay-types'

export function spliceOwnMobileRelaySockets(
  phone: WebSocket,
  host: WebSocket,
  bufferedFrames?: OwnMobileRelayBufferedFrame[]
): void {
  const forwardToHost = (raw: RawData, isBinary: boolean): void => {
    if (host.readyState === host.OPEN) {
      host.send(raw, { binary: isBinary })
    }
  }

  const forwardToPhone = (raw: RawData, isBinary: boolean): void => {
    if (phone.readyState === phone.OPEN) {
      phone.send(raw, { binary: isBinary })
    }
  }

  phone.on('message', forwardToHost)
  host.on('message', forwardToPhone)

  for (const frame of bufferedFrames ?? []) {
    if (host.readyState === host.OPEN) {
      host.send(frame.raw, { binary: frame.isBinary })
    }
  }

  phone.once('close', () => {
    host.off('message', forwardToPhone)
    if (host.readyState === host.OPEN) {
      host.close(4408, 'peer_closed')
    }
  })

  host.once('close', () => {
    phone.off('message', forwardToHost)
    if (phone.readyState === phone.OPEN) {
      phone.close(4408, 'peer_closed')
    }
  })
}
