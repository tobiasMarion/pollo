import { describe, expect, it } from 'vitest'
import { messageSchema, messageSchemas, messageTypes } from './index.js'

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
