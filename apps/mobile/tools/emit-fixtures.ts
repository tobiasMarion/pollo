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
  type Location,
  type MessageOf,
  messageSchemas,
  type NodePosition,
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
