import { describe, expect, it } from 'vitest'
import { Neighborhood } from './neighborhood.js'

const at = (x: number, y: number, z = 0) => ({ x, y, z })

/** Small enough to read, wide enough that a metre of jitter stays in one cell. */
const options = { degree: 4, radius: 10, cellSize: 10, refreshMs: 10_000 }

describe('Neighborhood', () => {
  it('hands a joining device a list', () => {
    const field = new Neighborhood(options)

    field.place('a', at(0, 0))
    field.place('b', at(2, 0))

    expect(field.takeAssignments(0)).toEqual([
      { deviceId: 'a', peers: ['b'] },
      { deviceId: 'b', peers: ['a'] },
    ])
  })

  it('does not tell the crowd that somebody arrived', () => {
    const field = new Neighborhood(options)

    field.place('a', at(0, 0))
    field.place('b', at(2, 0))
    field.takeAssignments(0)

    // `c` lands right between the two of them, and only `c` hears anything. This
    // is the entire point: an arrival used to be a frame for every device in the
    // event, and now it is a frame for the device that arrived.
    field.place('c', at(1, 2))

    expect(field.takeAssignments(1_000)).toEqual([{ deviceId: 'c', peers: ['a', 'b'] }])
  })

  it('picks the newcomer up at the refresh floor', () => {
    const field = new Neighborhood(options)

    field.place('a', at(0, 0))
    field.takeAssignments(0)

    field.place('b', at(2, 0))
    field.takeAssignments(1_000)

    // Nothing has happened to `a` — it has not moved and nobody it was measuring
    // has left — so only the clock brings it back round.
    expect(field.takeAssignments(20_000)).toEqual([{ deviceId: 'a', peers: ['b'] }])
  })

  it('says nothing when a device reports that it is still where it was', () => {
    const field = new Neighborhood(options)

    field.place('a', at(0, 0))
    field.place('b', at(2, 0))
    field.takeAssignments(0)

    field.place('a', at(1, 1))
    field.place('b', at(2.5, 0.5))

    expect(field.takeAssignments(1_000)).toEqual([])
  })

  it('ignores a reading that crossed a cell without going anywhere', () => {
    const field = new Neighborhood(options)

    field.place('a', at(9, 0))
    field.place('b', at(9, 2))
    field.takeAssignments(0)

    // Two metres east, over the line between cell 0 and cell 1. A phone standing
    // still reports this much wander all day, and reacting to it was costing 45%
    // of the process.
    field.place('a', at(11, 0))

    expect(field.takeAssignments(1_000)).toEqual([])
  })

  it('reconsiders a device that walked, and only that device', () => {
    const field = new Neighborhood(options)

    field.place('a', at(0, 0))
    field.place('b', at(2, 0))
    field.place('c', at(40, 0))
    field.takeAssignments(0)

    field.place('a', at(41, 0))

    // `b` still names `a` and is not told otherwise. That list is no longer the
    // best available, but it is not wrong — `a` exists and can be measured — and
    // telling everyone who measured a device that it moved is what turns one
    // move into seventeen recomputations.
    expect(field.takeAssignments(1_000)).toEqual([{ deviceId: 'a', peers: ['c'] }])
    expect(field.peersOf('b')).toEqual(['a'])
  })

  it('gives the measurers a new list once the floor comes round', () => {
    const field = new Neighborhood(options)

    field.place('a', at(0, 0))
    field.place('b', at(2, 0))
    field.takeAssignments(0)

    field.place('a', at(400, 0))
    field.takeAssignments(1_000)

    expect(field.takeAssignments(20_000)).toContainEqual({ deviceId: 'b', peers: [] })
  })

  it('tells the devices that were measuring somebody who left, and nobody else', () => {
    const field = new Neighborhood(options)

    field.place('a', at(0, 0))
    field.place('b', at(2, 0))
    field.place('far', at(400, 0))
    field.takeAssignments(0)

    field.remove('b')

    expect(field.takeAssignments(1_000)).toEqual([{ deviceId: 'a', peers: [] }])
  })

  it('says nothing when a device nobody was measuring leaves', () => {
    const field = new Neighborhood(options)

    field.place('a', at(0, 0))
    field.place('alone', at(400, 0))
    field.takeAssignments(0)

    field.remove('alone')

    expect(field.takeAssignments(1_000)).toEqual([])
  })

  it('stops naming a device once it has gone', () => {
    const field = new Neighborhood(options)

    field.place('a', at(0, 0))
    field.place('b', at(2, 0))
    field.takeAssignments(0)

    field.remove('b')
    field.takeAssignments(1_000)

    expect(field.peersOf('a')).toEqual([])
    expect(field.size).toBe(1)
  })

  it('ignores a device it never placed', () => {
    const field = new Neighborhood(options)

    expect(() => field.remove('ghost')).not.toThrow()
    expect(field.peersOf('ghost')).toEqual([])
  })

  it('keeps a list bounded however dense the crowd gets', () => {
    const field = new Neighborhood(options)

    for (let i = 0; i < 500; i++) {
      field.place(`d${i}`, at(Math.cos(i) * 5, Math.sin(i) * 5))
    }

    field.place('middle', at(0, 0))

    const assignments = field.takeAssignments(0)
    const middle = assignments.find(assignment => assignment.deviceId === 'middle')

    expect(middle?.peers.length).toBe(options.degree)
  })

  it('costs a message per arrival rather than a message per pair', () => {
    const field = new Neighborhood(options)
    let sent = 0

    for (let i = 0; i < 300; i++) {
      field.place(`d${i}`, at((i % 20) * 1.5, Math.floor(i / 20) * 1.5))
      sent += field.takeAssignments(i).length
    }

    // Three hundred people filing in, one flush each. Announcing every arrival to
    // everyone already inside is around forty-five thousand frames; here it is
    // one per arrival, because the only device that learns anything is the one
    // that just walked in. The rest catch up at the refresh floor.
    expect(sent).toBeLessThanOrEqual(300)
  })
})
