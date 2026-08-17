import type { Location, PositionPoint, PositionsMessage } from '@pollo/contracts'
import { beforeEach, describe, expect, it } from 'vitest'
import type { PositionPublisher } from '../redis/publisher.js'
import { LiveEvent } from './live-event.js'

const origin = { latitude: -29.6842, longitude: -53.8069 }

interface Published {
  kind: PositionsMessage['kind']
  points: readonly PositionPoint[]
}

/**
 * The publisher is a seam so a tick can be inspected without a Redis. What the
 * worker decided to send is the interesting part; that it reached a stream is
 * `publisher.ts`'s business.
 */
function recorder() {
  const sent: Published[] = []

  const publisher = {
    publish(_eventId: string, kind: Published['kind'], points: readonly PositionPoint[]) {
      sent.push({ kind, points })
    },
  } as unknown as PositionPublisher

  return { sent, publisher }
}

function location(partial: Partial<Location> = {}): Location {
  return {
    latitude: origin.latitude,
    longitude: origin.longitude,
    altitude: 100,
    horizontalAccuracy: 5,
    verticalAccuracy: 12,
    ...partial,
  }
}

describe('LiveEvent', () => {
  let sent: Published[]
  let event: LiveEvent

  beforeEach(() => {
    const recording = recorder()
    sent = recording.sent

    event = new LiveEvent({
      eventId: 'event-1',
      origin,
      publisher: recording.publisher,
      keyframeTicks: 3,
      epsilon: 0.05,
      // Nothing in this suite measures anything, and the point here is the
      // publishing rules rather than the reconstruction.
      minDegree: 0,
      solver: {
        anchor: { scale: 1 },
        huberKnee: 2,
        sweepsPerTick: 8,
        convergenceM: 0.002,
        omega: 1.5,
        alphaMin: 0.2,
        scaleBlend: 0.2,
        samplingStride: 7,
      },
    })
  })

  it('opens with a keyframe rather than waiting for one', () => {
    event.ingest({ at: 0, ops: [{ op: 'JOIN', deviceId: 'a', location: location() }] })
    event.tick()

    expect(sent[0]?.kind).toBe('keyframe')
    expect(sent[0]?.points).toHaveLength(1)
  })

  it('says nothing about a crowd that has not moved', () => {
    event.ingest({ at: 0, ops: [{ op: 'JOIN', deviceId: 'a', location: location() }] })
    event.tick()
    event.tick()

    expect(sent[1]?.kind).toBe('delta')
    expect(sent[1]?.points).toHaveLength(0)
  })

  it('sends a delta for the device that moved, and only that one', () => {
    event.ingest({
      at: 0,
      ops: [
        { op: 'JOIN', deviceId: 'a', location: location() },
        { op: 'JOIN', deviceId: 'b', location: location() },
      ],
    })
    event.tick()

    event.ingest({
      at: 1,
      ops: [{ op: 'LOCATION_UPDATE', deviceId: 'b', location: location({ altitude: 140 }) }],
    })
    event.tick()

    expect(sent[1]?.kind).toBe('delta')
    expect(sent[1]?.points.map(point => point.deviceId)).toEqual(['b'])
  })

  it('comes back round to a keyframe carrying everybody', () => {
    event.ingest({ at: 0, ops: [{ op: 'JOIN', deviceId: 'a', location: location() }] })

    event.tick() // keyframe
    event.tick()
    event.tick()
    event.tick() // keyframe again

    expect(sent.map(message => message.kind)).toEqual(['keyframe', 'delta', 'delta', 'keyframe'])
    expect(sent[3]?.points).toHaveLength(1)
  })

  it('stops naming a device that left', () => {
    event.ingest({ at: 0, ops: [{ op: 'JOIN', deviceId: 'a', location: location() }] })
    event.tick()

    event.ingest({ at: 1, ops: [{ op: 'LEAVE', deviceId: 'a' }] })
    event.tick()
    event.tick()
    event.tick()

    const named = sent.flatMap(message => message.points.map(point => point.deviceId))

    expect(named).toEqual(['a'])
  })

  /**
   * A slot is handed on when its device leaves. If the ledger kept the previous
   * tenant's coordinates, the newcomer's first position would read as a small
   * move and be held back by the threshold — a pixel that never appears.
   */
  it('sends the newcomer that inherited a slot', () => {
    event.ingest({ at: 0, ops: [{ op: 'JOIN', deviceId: 'a', location: location() }] })
    event.tick()

    event.ingest({
      at: 1,
      ops: [
        { op: 'LEAVE', deviceId: 'a' },
        { op: 'JOIN', deviceId: 'b', location: location() },
      ],
    })
    event.tick()

    expect(sent[1]?.points.map(point => point.deviceId)).toEqual(['b'])
  })

  it('places a device the graph says nothing about at its own GPS', () => {
    event.ingest({
      at: 0,
      ops: [
        {
          op: 'JOIN',
          deviceId: 'a',
          location: location({ latitude: origin.latitude + 0.001, altitude: 117 }),
        },
      ],
    })
    event.tick()

    const position = sent[0]?.points[0]?.position

    expect(position?.simulated.relative).toEqual(position?.uncorrected.relative)
    expect(position?.simulated.relative.y).toBeCloseTo(110.574, 3)
    expect(position?.simulated.relative.z).toBe(117)
  })
})
