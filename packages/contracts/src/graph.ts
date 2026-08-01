import { z } from 'zod'
import { locationSchema } from './location.js'

export const vector3Schema = z
  .object({
    x: z.number(),
    y: z.number(),
    z: z.number(),
  })
  .describe('A point in meters.')

export type Vector3 = z.infer<typeof vector3Schema>

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

/** A position in both frames: relative to the event origin and absolute (ECEF-like). */
export const positionPairSchema = z
  .object({
    relative: vector3Schema.describe('Offset from the event origin, in meters.'),
    absolute: vector3Schema.describe('Earth-centered coordinate, in meters.'),
  })
  .describe('The same point expressed in both frames.')

export type PositionPair = z.infer<typeof positionPairSchema>

/**
 * `uncorrected` comes straight from reported GPS locations; `simulated` is the
 * worker's force-directed refinement over the distance graph.
 */
export const positionSchema = z
  .object({
    uncorrected: positionPairSchema.describe('Straight from the reported GPS location.'),
    simulated: positionPairSchema.describe(
      'Force-directed refinement over the distance graph — this is what clients render.',
    ),
  })
  .describe('Where a pixel sits, before and after the simulation.')

export type NodePosition = z.infer<typeof positionSchema>

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
