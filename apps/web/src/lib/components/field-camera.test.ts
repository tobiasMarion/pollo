import { describe, expect, it } from 'vitest'
import { FieldCamera } from './field-camera'

describe('FieldCamera', () => {
  it('orbits without losing its origin and returns exactly to the default view', () => {
    const camera = new FieldCamera()
    camera.resize(1_000, 600)

    const defaultProjection = camera.project({ x: 10, y: 4, z: 2 })

    camera.orbit(0.4, -0.2)
    expect(camera.project({ x: 10, y: 4, z: 2 })).not.toEqual(defaultProjection)

    camera.reset()
    expect(camera.project({ x: 10, y: 4, z: 2 })).toEqual(defaultProjection)
    expect(camera.project({ x: 0, y: 0, z: 0 })).toEqual({ x: 500, y: 300 })
  })

  it('keeps deliberate zoom inside the useful range', () => {
    const camera = new FieldCamera()

    camera.zoom(-100_000)
    expect(camera.scale).toBe(60)

    camera.zoom(100_000)
    expect(camera.scale).toBe(0.4)
  })
})
