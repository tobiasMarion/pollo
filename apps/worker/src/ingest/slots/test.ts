import type { Location } from '@pollo/contracts'
import { describe, expect, it } from 'vitest'
import { SlotTable } from './index.js'

const origin = { latitude: -29.6842, longitude: -53.8069 }

function location(partial: Partial<Location> = {}): Location {
  return {
    latitude: origin.latitude,
    longitude: origin.longitude,
    altitude: 0,
    horizontalAccuracy: 5,
    verticalAccuracy: 12,
    ...partial,
  }
}

describe('SlotTable', () => {
  it('says whether a reading was an arrival or a device it already held', () => {
    const slots = new SlotTable(origin)

    expect(slots.place('a', location())).toEqual({ slot: 0, arrived: true })
    expect(slots.place('a', location({ altitude: 3 }))).toEqual({ slot: 0, arrived: false })
    expect(slots.size).toBe(1)
  })

  it('projects a reading into the field frame as it arrives', () => {
    const slots = new SlotTable(origin)

    slots.place('a', location({ altitude: 117.5 }))

    const anchor = slots.anchorAt(0)

    expect(anchor.x).toBeCloseTo(0, 9)
    expect(anchor.y).toBeCloseTo(0, 9)
    expect(anchor.z).toBe(117.5)
  })

  it('keeps the reading itself, accuracies and all', () => {
    const slots = new SlotTable(origin)

    slots.place('a', location({ horizontalAccuracy: 3.5 }))

    expect(slots.locationAt(0)?.horizontalAccuracy).toBe(3.5)
    expect(slots.deviceAt(0)).toBe('a')
    expect(slots.slotOf('a')).toBe(0)
  })

  it('has nothing to say about a slot nobody is in', () => {
    const slots = new SlotTable(origin)

    expect(slots.deviceAt(4)).toBeUndefined()
    expect(slots.locationAt(4)).toBeUndefined()
    expect(slots.slotOf('nobody')).toBeUndefined()
    expect(slots.release('nobody')).toBeUndefined()
  })

  /** A slot freed by a departure is handed to the next arrival. */
  it('recycles a departed slot rather than growing', () => {
    const slots = new SlotTable(origin)

    slots.place('a', location())
    slots.place('b', location())

    expect(slots.release('a')).toBe(0)
    expect(slots.size).toBe(1)
    expect(slots.place('c', location())).toEqual({ slot: 0, arrived: true })
    expect(slots.capacity).toBe(2)
  })

  it('reports a freed slot exactly once', () => {
    const slots = new SlotTable(origin)

    slots.place('a', location())
    slots.release('a')

    expect(slots.drainReleased()).toEqual([0])
    expect(slots.drainReleased()).toEqual([])
  })

  it('lists the live slots ascending and leaves out the empty ones', () => {
    const slots = new SlotTable(origin)

    for (const id of ['a', 'b', 'c']) slots.place(id, location())
    slots.release('b')

    expect([...slots.liveSlots()]).toEqual([0, 2])
  })

  it('survives more arrivals than it was sized for', () => {
    const slots = new SlotTable(origin)

    for (let i = 0; i < 600; i++) slots.place(`d${i}`, location({ altitude: i }))

    expect(slots.size).toBe(600)
    expect(slots.anchorAt(599).z).toBe(599)
    // Nothing already written is lost when the buffer grows underneath it.
    expect(slots.anchorAt(0).z).toBe(0)
  })
})
