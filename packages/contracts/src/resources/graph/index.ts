import { z } from 'zod'
import { locationSchema } from '../../primitives/location/index.js'
import { positionSchema } from '../../primitives/position/index.js'

/**
 * The distance graph as the panel fetches it — every device in an event, what is
 * known about each, and every measurement between them.
 *
 * A REST resource rather than a wire primitive: nothing streams this. It is the
 * snapshot a client asks for once, and then follows with deltas.
 */

export const nodeSchema = z.string().describe('A device id — one node of the distance graph.')

export const edgeSchema = z
  .object({
    from: nodeSchema.describe('Device that measured the distance.'),
    to: nodeSchema.describe('Device that was measured.'),
    value: z.number().describe('Measured distance in meters.'),
  })
  .describe('A measured distance. Directed — A→B and B→A are stored separately.')

export type Node = z.infer<typeof nodeSchema>
export type Edge = z.infer<typeof edgeSchema>

export const metadataSchema = z
  .object({
    location: locationSchema,
    position: positionSchema
      .nullish()
      .describe('Absent until the worker has published a position for this device.'),
  })
  .describe('What is known about one device in the graph.')

export type Metadata = z.infer<typeof metadataSchema>
export type NodesWithMetadata = Record<Node, Metadata>

export const eventGraphSchema = z
  .object({
    nodes: z.record(metadataSchema).describe('Device id -> what is known about that device.'),
    edges: z.array(edgeSchema).describe('Every measured distance, directed.'),
  })
  .describe('The graph. Both fields are empty until devices join and report.')

export type EventGraph = z.infer<typeof eventGraphSchema>

export const participantSchema = z
  .object({
    deviceId: nodeSchema.describe('Id the device sent in its `JOIN` message.'),
    location: locationSchema,
  })
  .describe('A device in the event, as the last thing it told us.')

export type Participant = z.infer<typeof participantSchema>
