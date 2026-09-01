import { describe, expect, it } from 'vitest'
import { messageTypes } from '../schemas/index.js'
import { adminInbound, adminOutbound, deviceInbound, deviceOutbound } from './index.js'

describe('directions', () => {
  it('let each end send only what it is meant to send', () => {
    expect(adminOutbound.schema.safeParse({ type: 'AUTHENTICATION', token: 'abc' }).success).toBe(
      true,
    )
    // A device frame on the admin socket is rejected, not quietly ignored.
    expect(adminOutbound.schema.safeParse({ type: 'JOIN', deviceId: 'a' }).success).toBe(false)
    expect(deviceOutbound.schema.safeParse({ type: 'AUTHENTICATION', token: 'abc' }).success).toBe(
      false,
    )
  })

  it('never has a client sending what only the server emits', () => {
    const serverOnly = ['AUTHENTICATION_ACK', 'USER_JOINED', 'USER_LEFT', 'SET_POINT'] as const

    for (const type of serverOnly) {
      expect(adminOutbound.types).not.toContain(type)
      expect(deviceOutbound.types).not.toContain(type)
    }
  })

  it('lets a peer token travel in both directions', () => {
    const frame = { type: 'PEER_TOKEN', peer: 'device-2', token: 'a-token' }

    // A relayed frame goes back out in the shape it came in — the server only
    // swaps `peer` for the sender — so both device directions have to take it.
    expect(deviceOutbound.schema.safeParse(frame).success).toBe(true)
    expect(deviceInbound.schema.safeParse(frame).success).toBe(true)
  })

  it('covers every message type across the four directions', () => {
    const covered = new Set([
      ...adminOutbound.types,
      ...adminInbound.types,
      ...deviceOutbound.types,
      ...deviceInbound.types,
    ])

    expect(covered).toEqual(new Set(messageTypes))
  })
})
