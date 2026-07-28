import { z } from 'zod';
import { locationSchema } from './location.js';

export const vector3Schema = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number(),
});

export type Vector3 = z.infer<typeof vector3Schema>;

export const nodeSchema = z.string();

export const edgeSchema = z.object({
  from: nodeSchema,
  to: nodeSchema,
  value: z.number(),
});

export type Node = z.infer<typeof nodeSchema>;
export type Edge = z.infer<typeof edgeSchema>;

/** A position in both frames: relative to the event origin and absolute (ECEF-like). */
export const positionPairSchema = z.object({
  relative: vector3Schema,
  absolute: vector3Schema,
});

export type PositionPair = z.infer<typeof positionPairSchema>;

/**
 * `uncorrected` comes straight from reported GPS locations; `simulated` is the
 * worker's force-directed refinement over the distance graph.
 */
export const positionSchema = z.object({
  uncorrected: positionPairSchema,
  simulated: positionPairSchema,
});

export type NodePosition = z.infer<typeof positionSchema>;

export const metadataSchema = z.object({
  location: locationSchema,
  position: positionSchema.nullish(),
});

export type Metadata = z.infer<typeof metadataSchema>;
export type NodesWithMetadata = Record<Node, Metadata>;
