import type { Vector3 } from '@pollo/contracts'
import type { Random } from '../noise/random.js'

/** Shoulder to shoulder: how far apart two people in the same row stand. */
export const SEAT_PITCH = 0.55

/** A phone is held at chest height, whether its owner is standing or seated. */
export const PHONE_HEIGHT = 1.4

/** How far from the mark the layout drew a person actually ends up, in meters. */
const JITTER = 0.06

export interface Seat {
  /** Ground truth in the field frame: meters east, north and up of the origin. */
  point: Vector3
  /** Which bank of seating this belongs to — the floor is 0, a balcony is above. */
  level: number
}

/**
 * Nobody stands exactly where the plan says. The jitter is not decoration: a
 * perfectly regular lattice is a constraint no real crowd hands the worker, and
 * a reconstruction tuned against one has been tuned against a lattice.
 */
export function seatAt(point: Vector3, level: number, random: Random): Seat {
  return {
    point: {
      x: point.x + random.between(-JITTER, JITTER),
      y: point.y + random.between(-JITTER, JITTER),
      // Height varies with the person, not with where they are standing, so it
      // wanders less than the floor plan does.
      z: point.z + random.between(-JITTER / 2, JITTER / 2),
    },
    level,
  }
}
