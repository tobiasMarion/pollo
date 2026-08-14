import type { Vector3 } from '@pollo/contracts'
import { FieldGrid } from './field-grid.js'
import { chooseNeighbors } from './neighbor-choice.js'

/** How often assignments are cut and handed out. */
export const ASSIGNMENT_INTERVAL_MS = 1_000

/**
 * How far apart two devices may be for the server to suggest measuring them.
 * Sized for GPS rather than radio: a wrong suggestion costs one `null` distance,
 * while a peer never suggested is an edge nobody will ever miss. Comes down once
 * the worker is publishing positions.
 */
export const DEFAULT_RADIUS_M = 10

/** Half the radius: tight enough to keep the scan small, coarse enough to keep moves rare. */
export const DEFAULT_CELL_SIZE_M = 5

/**
 * Planar rigidity needs four to six well-spread directions. Sixteen leaves room
 * for the suggestions that turn out to be beyond radio range.
 */
export const DEFAULT_DEGREE = 16

/**
 * The floor under everything else here, which is event-driven: a device that
 * never moves, beside peers that never leave, still has a crowd changing around
 * it without anything happening *to* it.
 */
export const DEFAULT_REFRESH_MS = 10_000

export interface NeighborhoodOptions {
  degree?: number
  radius?: number
  cellSize?: number
  refreshMs?: number
}

/** A device and the peers it should now be measuring. */
export interface Assignment {
  deviceId: string
  peers: string[]
}

interface Placed {
  point: Vector3
  peers: string[]
  /** Reconsider on the next flush, whatever the clock says. */
  stale: boolean
  refreshDueAt: number
}

/**
 * Decides who measures whom, and — the part that matters for load — who has to
 * be told about it.
 *
 * The protocol this replaces answers "who can I range against?" by describing
 * the whole crowd: a roster on join, then a `USER_JOINED` to everybody every
 * time anyone arrives. Turning the question around collapses the cost. The
 * server does not announce arrivals; it tells each device which peers to
 * measure, and that answer is a fixed handful however large the crowd gets.
 *
 * A list is reconsidered when something happened to *its* corner of the field:
 * the device walked, a peer it measures walked or left, or the refresh floor
 * came round. Arrivals are absent from that list — the device that arrived is
 * new and therefore due, and nobody else needs to hear about it.
 *
 * Positions are in the event's local frame rather than latitudes, so they can
 * become the worker's solved coordinates without touching any of this.
 */
export class Neighborhood {
  private readonly degree: number
  private readonly radius: number
  private readonly refreshMs: number

  private readonly grid: FieldGrid
  private readonly devices = new Map<string, Placed>()

  /**
   * Who is measuring each device. Without this reverse index, a departure is
   * either a broadcast to the crowd or a scan of every list in it.
   */
  private readonly measuredBy = new Map<string, Set<string>>()

  private readonly candidates: string[] = []

  /** Spreads the refresh floor out. See `scheduleRefresh`. */
  private refreshes = 0

  constructor({ degree, radius, cellSize, refreshMs }: NeighborhoodOptions = {}) {
    this.degree = degree ?? DEFAULT_DEGREE
    this.radius = radius ?? DEFAULT_RADIUS_M
    this.refreshMs = refreshMs ?? DEFAULT_REFRESH_MS
    this.grid = new FieldGrid(cellSize ?? DEFAULT_CELL_SIZE_M)
  }

  get size() {
    return this.devices.size
  }

  /** The list this device was last given, for anyone who missed the assignment. */
  peersOf(deviceId: string): readonly string[] {
    return this.devices.get(deviceId)?.peers ?? []
  }

  /**
   * Records where a device is. Joining and moving are the same call: the
   * difference between them is a fact about the socket, not about the field.
   */
  place(deviceId: string, point: Vector3) {
    const changedCell = this.grid.place(deviceId, point)
    const placed = this.devices.get(deviceId)

    if (!placed) {
      this.devices.set(deviceId, { point, peers: [], stale: true, refreshDueAt: 0 })
      return
    }

    placed.point = point

    if (!changedCell) return

    placed.stale = true

    // Whoever measures this device is now aiming at where it used to be — the
    // same relationship as a departure, and walking is rare enough to be noise.
    this.markMeasurersStale(deviceId)
  }

  /**
   * Takes a device out of the field and marks the ones that were measuring it.
   * Nobody else is told — the rest of the crowd never knew it existed.
   */
  remove(deviceId: string) {
    const placed = this.devices.get(deviceId)
    if (!placed) return

    this.grid.remove(deviceId)
    this.devices.delete(deviceId)

    this.markMeasurersStale(deviceId)
    this.measuredBy.delete(deviceId)
    this.forgetMeasurements(deviceId, placed.peers)
  }

  private markMeasurersStale(deviceId: string) {
    for (const measurer of this.measuredBy.get(deviceId) ?? []) {
      const placed = this.devices.get(measurer)

      if (placed) placed.stale = true
    }
  }

  /**
   * Recomputes every device that is due and returns only those whose list came
   * out different — the filter that ties the message rate to how much the crowd
   * is rearranging itself rather than to how many devices there are.
   *
   * Finding the due ones walks everybody, which is O(n) once a second and not
   * the O(n) *per arrival* this class exists to remove.
   */
  takeAssignments(now = Date.now()): Assignment[] {
    const changed: Assignment[] = []

    for (const [deviceId, placed] of this.devices) {
      if (!placed.stale && now < placed.refreshDueAt) continue

      const peers = chooseNeighbors({
        deviceId,
        point: placed.point,
        candidates: this.grid.around(placed.point, this.radius, this.candidates),
        pointOf: id => this.devices.get(id)?.point,
        degree: this.degree,
        radius: this.radius,
      })

      placed.stale = false
      placed.refreshDueAt = this.scheduleRefresh(now)

      if (sameList(placed.peers, peers)) continue

      this.forgetMeasurements(deviceId, placed.peers)
      this.recordMeasurements(deviceId, peers)

      placed.peers = peers
      changed.push({ deviceId, peers })
    }

    return changed
  }

  /**
   * Spread over the second half of the window rather than parked at the end.
   * A crowd computed in one flush would otherwise all come due in one later
   * flush, and the floor would arrive as a spike.
   */
  private scheduleRefresh(now: number) {
    const half = this.refreshMs / 2

    return now + half + (this.refreshes++ % half)
  }

  private recordMeasurements(deviceId: string, peers: readonly string[]) {
    for (const peer of peers) {
      let measurers = this.measuredBy.get(peer)

      if (!measurers) {
        measurers = new Set()
        this.measuredBy.set(peer, measurers)
      }

      measurers.add(deviceId)
    }
  }

  private forgetMeasurements(deviceId: string, peers: readonly string[]) {
    for (const peer of peers) {
      const measurers = this.measuredBy.get(peer)
      if (!measurers) continue

      measurers.delete(deviceId)

      if (measurers.size === 0) this.measuredBy.delete(peer)
    }
  }
}

/**
 * Order counts as a difference, deliberately: lists come out in sector order, so
 * a reordering means bearings crossed a boundary, which means somebody moved.
 */
function sameList(before: readonly string[], after: readonly string[]) {
  if (before.length !== after.length) return false

  return before.every((deviceId, index) => deviceId === after[index])
}
