/**
 * The geometric types the wire carries, re-exported from `@pollo/geometry`.
 *
 * A coordinate is a mathematical object before it is a message field, so the
 * type is declared where the arithmetic lives and the schema that validates it
 * stays here. Consumers that only need the shape keep importing it from the
 * contracts, which is where they were already looking.
 */
export type { Origin, Vector3 } from '@pollo/geometry'
