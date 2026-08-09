import WebSocket from 'ws'

export interface TransportHandlers {
  open(): void
  message(raw: string): void
  error(): void
  close(): void
}

export interface Transport {
  /** Returns whether the frame actually went out. */
  send(payload: string): boolean
  close(): void
}

/**
 * How a device reaches the API. A seam rather than a direct `new WebSocket`,
 * and the reason is testing: what a device does when it joins, drifts, drops
 * and comes back is a state machine, and a state machine that can only be
 * exercised by standing up a server is one nobody exercises.
 */
export type Connect = (url: string, handlers: TransportHandlers) => Transport

export const webSocketTransport: Connect = (url, handlers) => {
  const socket = new WebSocket(url)

  socket.on('open', () => handlers.open())
  socket.on('message', (raw: Buffer) => handlers.message(raw.toString()))
  socket.on('error', () => handlers.error())
  socket.on('close', () => handlers.close())

  return {
    send(payload) {
      if (socket.readyState !== WebSocket.OPEN) return false

      socket.send(payload)
      return true
    },
    close() {
      socket.close()
    },
  }
}
