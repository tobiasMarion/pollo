import { EventEmitter } from 'node:events'
import type { WebSocket } from '@fastify/websocket'
import { describe, expect, it } from 'vitest'
import { Heartbeat } from './heartbeat.js'

class FakeSocket extends EventEmitter {
  pings = 0
  terminated = false

  ping() {
    this.pings++
  }

  terminate() {
    this.terminated = true
    this.emit('close')
  }
}

function watched(heartbeat: Heartbeat) {
  const socket = new FakeSocket()
  heartbeat.watch(socket as unknown as WebSocket)

  return socket
}

describe('Heartbeat', () => {
  it('pings a silent socket, and gives up only after it stays silent', () => {
    const heartbeat = new Heartbeat()
    const socket = watched(heartbeat)

    heartbeat.sweep()
    heartbeat.sweep()

    expect(socket.pings).toBe(2)
    expect(socket.terminated).toBe(false)

    heartbeat.sweep()

    expect(socket.terminated).toBe(true)
    expect(heartbeat.size).toBe(0)
  })

  it('takes a pong as proof of life', () => {
    const heartbeat = new Heartbeat()
    const socket = watched(heartbeat)

    for (let sweep = 0; sweep < 10; sweep++) {
      heartbeat.sweep()
      socket.emit('pong')
    }

    expect(socket.terminated).toBe(false)
  })

  it('takes traffic as proof of life, and never pings a busy socket twice over', () => {
    const heartbeat = new Heartbeat()
    const socket = watched(heartbeat)

    // A device reports where it is and how far its neighbours are. Asking it to
    // confirm it exists is a question it has already answered.
    for (let sweep = 0; sweep < 10; sweep++) {
      socket.emit('message')
      heartbeat.sweep()
      socket.emit('message')
    }

    expect(socket.terminated).toBe(false)
    expect(socket.pings).toBe(10)
  })

  it('forgets a socket that closed on its own', () => {
    const heartbeat = new Heartbeat()
    const socket = watched(heartbeat)

    socket.emit('close')

    expect(heartbeat.size).toBe(0)

    heartbeat.sweep()

    expect(socket.pings).toBe(0)
  })

  it('watches every socket on one timer', () => {
    const heartbeat = new Heartbeat()
    const sockets = [watched(heartbeat), watched(heartbeat), watched(heartbeat)]

    expect(heartbeat.size).toBe(3)

    heartbeat.sweep()

    expect(sockets.map(socket => socket.pings)).toEqual([1, 1, 1])
  })
})
