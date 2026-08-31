import { describe, expect, it } from 'vitest'
import { effectNames, effectSchema, effectSchemas } from './index.js'

describe('the derived union', () => {
  it('carries every member of the record', () => {
    expect(effectNames).toHaveLength(Object.keys(effectSchemas).length)
    expect(new Set(effectSchema.options.map(option => option.shape.name.value))).toEqual(
      new Set(effectNames),
    )
  })

  it('rejects an unknown effect name', () => {
    expect(effectSchema.safeParse({ name: 'STROBE', activeTime: 1 }).success).toBe(false)
  })

  it('rejects a negative duration', () => {
    expect(
      effectSchema.safeParse({ name: 'ROTATE', activeTime: -1, spreadDelayPerRadian: 0 }).success,
    ).toBe(false)
  })

  // The descriptions are what the API reference shows for a cue; an effect
  // nobody described reaches the docs as a name and four bare numbers.
  it('describes every effect and every parameter of it', () => {
    for (const [name, schema] of Object.entries(effectSchemas)) {
      expect(schema.description, `${name} has no description`).toBeTruthy()

      for (const [field, value] of Object.entries(schema.shape)) {
        if (field === 'name') continue
        expect(value.description, `${name}.${field} has no description`).toBeTruthy()
      }
    }
  })
})
