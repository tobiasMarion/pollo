import type { z } from 'zod'
import { subsetOf, unionFrom } from '../union.js'
import { type MessageType, messageSchemas } from './schemas.js'

/**
 * A socket only ever carries a handful of the message types in either
 * direction. Naming those subsets here gives each end a schema that rejects an
 * out-of-direction frame outright, instead of every socket parsing all twelve
 * and quietly dropping what makes no sense for it.
 *
 * **Inbound and outbound are named from the client's side**: what the panel or
 * the device sends is outbound, what the API sends back is inbound.
 */
function direction<const Types extends readonly MessageType[]>(types: Types) {
  const schemas = subsetOf(messageSchemas, types)

  return { types, schemas, schema: unionFrom('type', schemas) }
}

/** What the admin panel sends. */
export const adminOutbound = direction(['AUTHENTICATION', 'EFFECT'])

/**
 * What the admin panel receives: the field in batches, plus the echo of its own
 * cue.
 *
 * Deliberately short. Relaying a frame per device event puts the panel on the
 * hook for every message the crowd generates, which is tens of thousands a
 * second at the scale this is built for; `FIELD_UPDATE` is the same information
 * on a cadence the browser sets rather than the crowd.
 */
export const adminInbound = direction(['AUTHENTICATION_ACK', 'FIELD_UPDATE', 'EFFECT'])

/** What a device sends: where it is, and how far its peers are. */
export const deviceOutbound = direction(['JOIN', 'LOCATION_UPDATE', 'DISTANCE'])

/** What a device receives: its own position, who to measure, and cues. */
export const deviceInbound = direction(['SET_POINT', 'SET_NEIGHBORS', 'EFFECT'])

export type AdminOutboundMessage = z.infer<typeof adminOutbound.schema>
export type AdminInboundMessage = z.infer<typeof adminInbound.schema>
export type DeviceOutboundMessage = z.infer<typeof deviceOutbound.schema>
export type DeviceInboundMessage = z.infer<typeof deviceInbound.schema>
