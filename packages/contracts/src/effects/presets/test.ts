import { describe, expect, it } from 'vitest'
import { effectNames, effectSchema } from '../schemas/index.js'
import { effectPresets } from './index.js'

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
