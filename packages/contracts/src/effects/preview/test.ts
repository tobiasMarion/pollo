import { describe, expect, it } from 'vitest'
import { effectPresets } from '../presets/index.js'
import { effectNames } from '../schemas/index.js'
import { effectBrightness, effectDelaySeconds } from './index.js'

const center = { x: 0, y: 0, z: 0 }

/** One sample per effect, taken from the deck so the two stay in step. */
const samples = effectNames.map(name => {
  const preset = effectPresets.find(entry => entry.effect.name === name)
  if (!preset) throw new Error(`no preset fires ${name}`)

  return preset.effect
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
