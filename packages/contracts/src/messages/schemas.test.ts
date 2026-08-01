import { describe, expect, it } from 'vitest'
import { adminInbound, adminOutbound, deviceInbound, deviceOutbound } from './directions.js'
import { safeParseJsonMessage } from './parse.js'
import { messageSchema, messageSchemas, messageTypes } from './schemas.js'

describe('safeParseJsonMessage', () => {
  it('parses a valid message', () => {
    const result = safeParseJsonMessage(
      JSON.stringify({ type: 'AUTHENTICATION', token: 'abc' }),
      messageSchema,
    )

    expect(result.success).toBe(true)
    expect(result.data).toEqual({ type: 'AUTHENTICATION', token: 'abc' })
  })

  it('fails on malformed JSON without throwing', () => {
    const result = safeParseJsonMessage('{not json', messageSchema)

    expect(result.success).toBe(false)
    expect(result.error).toEqual({ message: 'Invalid JSON' })
  })

  it('fails on a payload that does not match the schema', () => {
    const result = safeParseJsonMessage(JSON.stringify({ type: 'UNKNOWN' }), messageSchema)

    expect(result.success).toBe(false)
    expect(result.data).toBeNull()
  })
})

describe('the derived union', () => {
  it('carries every member of the record', () => {
    expect(messageTypes).toHaveLength(Object.keys(messageSchemas).length)
    expect(new Set(messageSchema.options.map(option => option.shape.type.value))).toEqual(
      new Set(messageTypes),
    )
  })

  it('keys each member by its own type', () => {
    for (const [key, schema] of Object.entries(messageSchemas)) {
      expect(schema.shape.type.value).toBe(key)
    }
  })
})

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
