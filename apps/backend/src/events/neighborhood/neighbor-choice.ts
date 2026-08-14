import type { Vector3 } from '@pollo/contracts'

const FULL_TURN = Math.PI * 2

export interface NeighborChoice {
  /** The device being handed a list. Never suggested to itself. */
  deviceId: string
  point: Vector3
  /** Everyone worth considering, corners of the grid's square window included. */
  candidates: Iterable<string>
  /** Where a candidate is standing, or `undefined` if it has since left. */
  pointOf: (deviceId: string) => Vector3 | undefined
  /** How many peers to ask for, and therefore how many directions to cover. */
  degree: number
  /** Metres. Past this a measurement is not worth suggesting. */
  radius: number
}

interface Nearest {
  deviceId: string
  distance: number
}

/**
 * Chooses which peers a device should measure: the nearest one in each of
 * `degree` directions around it.
 *
 * Taking the `degree` closest instead is the obvious policy and the wrong one.
 * The worker needs rigidity rather than density — a position is pinned down by
 * distances pulling from different sides — and in a standing crowd the closest
 * peers are frequently all on one side.
 *
 * A device on the edge gets a shorter list on purpose: an empty sector means
 * nobody is over there, and a second peer in a covered direction constrains
 * almost nothing the first one did not.
 *
 * Sectors are horizontal; distance is not, so nobody a floor above is suggested
 * on the strength of standing in the same place on the plan.
 */
export function chooseNeighbors({
  deviceId,
  point,
  candidates,
  pointOf,
  degree,
  radius,
}: NeighborChoice): string[] {
  if (degree <= 0) return []

  const nearestPerSector = new Array<Nearest | undefined>(degree)

  for (const candidate of candidates) {
    if (candidate === deviceId) continue

    const there = pointOf(candidate)
    if (!there) continue

    const east = there.x - point.x
    const north = there.y - point.y
    const up = there.z - point.z

    const distance = Math.hypot(east, north, up)
    if (distance > radius) continue

    const sector = sectorOf(east, north, degree)
    const held = nearestPerSector[sector]

    if (!held || distance < held.distance) {
      nearestPerSector[sector] = { deviceId: candidate, distance }
    }
  }

  const peers: string[] = []

  // Sector order, so an unchanged neighbourhood produces an identical list.
  for (const nearest of nearestPerSector) {
    if (nearest) peers.push(nearest.deviceId)
  }

  return peers
}

/** Which slice of the compass a peer falls in, counting east-first. */
function sectorOf(east: number, north: number, sectors: number) {
  const bearing = Math.atan2(north, east)
  const turned = bearing < 0 ? bearing + FULL_TURN : bearing

  // A bearing of exactly one full turn would index past the last sector.
  return Math.min(sectors - 1, Math.floor((turned / FULL_TURN) * sectors))
}
