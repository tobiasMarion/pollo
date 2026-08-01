import { describe, expect, it } from 'vitest'
import { effectPresets } from './presets.js'
import { effectBrightness, effectDelaySeconds } from './preview.js'
import { effectNames, effectSchema, effectSchemas } from './schemas.js'

const center = { x: 0, y: 0, z: 0 }

/** One sample per effect, taken from the deck so the two stay in step. */
const samples = effectNames.map(name => {
  const preset = effectPresets.find(entry => entry.effect.name === name)
  if (!preset) throw new Error(`no preset fires ${name}`)

  return preset.effect
})

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

describe('the deck', () => {
  it('fires every effect the schemas define', () => {
    const covered = new Set(effectPresets.map(preset => preset.effect.name))

    expect(covered).toEqual(new Set(effectNames))
  })

  it('validates every cue it ships', () => {
    for (const preset of effectPresets) {
      expect(effectSchema.safeParse(preset.effect).success).toBe(true)
    }
  })
})

describe('preview', () => {
  it('has a delay for every effect', () => {
    for (const effect of samples) {
      const delay = effectDelaySeconds(effect, { x: 3, y: 4, z: 0 }, center)

      expect(Number.isFinite(delay)).toBe(true)
      expect(delay).toBeGreaterThanOrEqual(0)
    }
  })

  it('leaves a pixel dark before its turn and after the pass', () => {
    for (const effect of samples) {
      const point = { x: 20, y: 20, z: 0 }
      const delay = effectDelaySeconds(effect, point, center)

      expect(effectBrightness(effect, point, center, delay - 0.01)).toBe(0)
      expect(effectBrightness(effect, point, center, delay + effect.activeTime + 0.01)).toBe(0)
    }
  })

  it('peaks halfway through the pass', () => {
    for (const effect of samples) {
      const point = { x: 5, y: 0, z: 0 }
      const delay = effectDelaySeconds(effect, point, center)
      const peak = effectBrightness(effect, point, center, delay + effect.activeTime / 2)

      expect(peak).toBeCloseTo(1, 5)
    }
  })
})
