import type { EventGraph, MessageOf } from '@pollo/contracts'
import { describe, expect, it } from 'vitest'
import { FieldState } from './field-state.svelte'

const location = {
  latitude: -29.7,
  longitude: -53.7,
  altitude: 100,
  horizontalAccuracy: 5,
  verticalAccuracy: 8,
}

describe('FieldState', () => {
  it('replaces stale devices and edges with an authoritative snapshot', () => {
    const field = new FieldState()
    field.replace({
      nodes: { ghost: { location } },
      edges: [{ from: 'ghost', to: 'gone', value: 2 }],
    })

    field.replace({ nodes: { present: { location } }, edges: [] })

    expect([...field.devices.keys()]).toEqual(['present'])
    expect([...field.edges]).toEqual([])
  })

  it('applies deltas that land after the snapshot', () => {
    const field = new FieldState()
    const graph: EventGraph = { nodes: { a: { location } }, edges: [] }
    const update: MessageOf<'FIELD_UPDATE'> = {
      type: 'FIELD_UPDATE',
      at: 1,
      window: 1_000,
      locations: [{ deviceId: 'b', location }],
      placed: [],
      left: ['a'],
      edges: [{ from: 'b', to: 'c', distance: 3 }],
    }

    field.replace(graph)
    field.apply(update)

    expect([...field.devices.keys()]).toEqual(['b'])
    expect([...field.edges.values()]).toEqual([{ from: 'b', to: 'c', value: 3 }])
  })
})
