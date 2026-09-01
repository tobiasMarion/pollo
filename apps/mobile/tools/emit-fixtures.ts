/**
 * Writes the JSON the Swift tests decode, from the contract itself.
 *
 * The samples below are typed as the frames they stand for, so a field that
 * changes shape in `@pollo/contracts` fails to compile here, and every one is
 * validated before it is written — a fixture that the server would reject
 * teaches the client the wrong thing. The records are keyed by the message and
 * effect names, so leaving one out is a type error rather than a gap nobody
 * notices until a phone drops a frame in a field.
 */

import { writeFileSync } from 'node:fs'
import {
  type DeviceInboundMessage,
  type DeviceOutboundMessage,
  type Effect,
  type EffectName,
  effectBrightness,
  effectDelaySeconds,
  type Location,
  type MessageOf,
  messageSchemas,
  type NodePosition,
  type Vector3,
} from '@pollo/contracts'

const location: Location = {
  latitude: -29.6842,
  longitude: -53.8069,
  horizontalAccuracy: 4.5,
  altitude: 113.25,
  verticalAccuracy: 8,
}

const position: NodePosition = {
  uncorrected: {
    relative: { x: 1.5, y: -2.25, z: 0 },
    absolute: { x: 4510123.5, y: -3605987.25, z: -3140456.75 },
  },
  simulated: {
    relative: { x: 1.75, y: -2, z: 0.5 },
    absolute: { x: 4510123.75, y: -3605987, z: -3140456.25 },
  },
}

/** What a phone sends. Keyed by type, so the compiler counts them for us. */
const outbound: { [Type in DeviceOutboundMessage['type']]: MessageOf<Type> } = {
  JOIN: { type: 'JOIN', deviceId: 'device-1', location },
  LOCATION_UPDATE: { type: 'LOCATION_UPDATE', location },
  DISTANCES: {
    type: 'DISTANCES',
    // A reading and a retraction in one sweep: `null` is a value the wire
    // carries, not an absence, and it is the half a decoder gets wrong.
    measurements: [
      { to: 'device-2', distance: 3.25 },
      { to: 'device-3', distance: null },
    ],
  },
  PEER_TOKEN: { type: 'PEER_TOKEN', peer: 'device-2', token: 'BGtleXMBAQ==' },
}

/** What a phone is told. */
const inbound: { [Type in DeviceInboundMessage['type']]: MessageOf<Type> } = {
  SET_POINT: { type: 'SET_POINT', position },
  SET_NEIGHBORS: { type: 'SET_NEIGHBORS', peers: ['device-2', 'device-3'] },
  EFFECT: {
    type: 'EFFECT',
    effect: { name: 'WAVE', direction: 'X', activeTime: 1.5, spreadDelayPerUnit: 0.02 },
    center: { x: 0.5, y: -1.25, z: 0 },
  },
  PEER_TOKEN: { type: 'PEER_TOKEN', peer: 'device-4', token: 'BGtleXMCAg==' },
}

const effects: { [Name in EffectName]: Extract<Effect, { name: Name }> } = {
  PULSE: { name: 'PULSE', coordinateType: 'RELATIVE', activeTime: 1.2, spreadDelayPerUnit: 0.05 },
  WAVE: { name: 'WAVE', direction: 'Y', activeTime: 0.8, spreadDelayPerUnit: 0.03 },
  ROTATE: { name: 'ROTATE', activeTime: 1, spreadDelayPerRadian: 0.4 },
  SPIRAL: { name: 'SPIRAL', activeTime: 0.6, radialSpeed: 8, angularSpeed: 2.5 },
}

/**
 * Points chosen to reach the branches rather than to look like a crowd: dead on
 * the centre, on each axis in both directions, off-axis, and above the field.
 */
const points: Vector3[] = [
  { x: 0, y: 0, z: 0 },
  { x: 12, y: 0, z: 0 },
  { x: -12, y: 0, z: 0 },
  { x: 0, y: 9.5, z: 0 },
  { x: -7.5, y: -4.25, z: 0 },
  { x: 3, y: 4, z: 6 },
]

const center: Vector3 = { x: 1, y: -1, z: 0 }
const elapsedSeconds = [0, 0.25, 0.9, 2.5]

const brightness = Object.values(effects).flatMap(effect =>
  points.flatMap(point =>
    elapsedSeconds.map(elapsed => ({
      effect,
      point,
      center,
      elapsed,
      delay: effectDelaySeconds(effect, point, center),
      brightness: effectBrightness(effect, point, center, elapsed),
    })),
  ),
)

/** A sample the API would refuse is a sample that teaches the client a lie. */
function checked<Frame extends { type: keyof typeof messageSchemas }>(frame: Frame): Frame {
  const result = messageSchemas[frame.type].safeParse(frame)

  if (!result.success) {
    throw new Error(`${frame.type} sample does not match the contract: ${result.error.message}`)
  }

  return frame
}

for (const frame of [...Object.values(outbound), ...Object.values(inbound)]) checked(frame)

function write(name: string, value: unknown) {
  const path = new URL(`../Fixtures/${name}`, import.meta.url)

  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
  console.log(`wrote Fixtures/${name}`)
}

write('messages.json', { outbound, inbound })
write('effects.json', { cases: brightness })
