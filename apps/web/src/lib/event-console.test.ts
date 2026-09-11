import type { EventGraph, MessageOf } from '@pollo/contracts'
import { describe, expect, it } from 'vitest'
import { EventConsole } from './event-console.svelte'

const location = {
  latitude: -29.7,
  longitude: -53.7,
  altitude: 100,
  horizontalAccuracy: 5,
  verticalAccuracy: 8,
}

class FakeSocket {
  readonly sent: string[] = []
  private readonly listeners = new Map<string, Array<(event: never) => void>>()

  addEventListener(type: string, listener: (event: never) => void) {
    const listeners = this.listeners.get(type) ?? []
    listeners.push(listener)
    this.listeners.set(type, listeners)
  }

  send(frame: string) {
    this.sent.push(frame)
  }

  close() {
    this.emit('close', { code: 1000, reason: '' })
  }

  emit(type: string, event: unknown) {
    for (const listener of this.listeners.get(type) ?? []) listener(event as never)
  }
}

describe('EventConsole', () => {
  it('buffers live deltas while a reconnect snapshot is loading', async () => {
    const socket = new FakeSocket()
    let finishLoading: (graph: EventGraph) => void = () => {}
    const graph = new Promise<EventGraph>(resolve => {
      finishLoading = resolve
    })
    const console = new EventConsole('1c64d77f-5801-44fa-8f68-dce4238f052f', 'token', {
      loadGraph: () => graph,
      openSocket: () => socket as unknown as WebSocket,
    })

    console.hydrate({ nodes: { ghost: { location } }, edges: [] })
    console.connect()
    socket.emit('open', {})
    socket.emit('message', { data: JSON.stringify({ type: 'AUTHENTICATION_ACK' }) })

    const update: MessageOf<'FIELD_UPDATE'> = {
      type: 'FIELD_UPDATE',
      at: 1,
      window: 1_000,
      locations: [{ deviceId: 'newcomer', location }],
      placed: [],
      left: [],
      edges: [],
    }
    socket.emit('message', { data: JSON.stringify(update) })

    finishLoading({ nodes: { present: { location } }, edges: [] })
    await graph
    await Promise.resolve()

    expect([...console.devices.keys()]).toEqual(['present', 'newcomer'])
    expect(console.status).toBe('live')
    expect(JSON.parse(socket.sent[0] ?? '{}')).toEqual({
      type: 'AUTHENTICATION',
      token: 'token',
    })

    console.destroy()
  })
})
