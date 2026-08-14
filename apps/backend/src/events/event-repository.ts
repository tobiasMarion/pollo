import type { CreateEvent } from '@pollo/contracts'
import { z } from 'zod'
import { Prisma, type PrismaClient } from '../generated/prisma/client.js'

/**
 * Every question anyone asks the `events` table, in one place — the boundary
 * `GraphStore` has always given Redis and Postgres never had.
 */
export class EventRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string) {
    return await this.prisma.event.findUnique({ where: { id } })
  }

  /** Events somebody opened, newest first. */
  async listByAdmin(userId: string) {
    return await this.prisma.event.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    })
  }

  /** Every event the runtime should be holding open, for a process that just booted. */
  async listOpen() {
    return await this.prisma.event.findMany({ where: { status: 'OPEN' } })
  }

  /**
   * A boolean rather than the row: the caller is an authorisation check, and a
   * row handed back is a row somebody can accidentally reply with.
   */
  async isOpenAdmin(eventId: string, userId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId, userId, status: 'OPEN' },
      select: { id: true },
    })

    return event !== null
  }

  async create({ name, latitude, longitude, type }: CreateEvent, adminId: string) {
    return await this.prisma.event.create({
      data: { name, latitude, longitude, type, userId: adminId },
    })
  }

  /** Ends an event for good. A `FINISHED` event never reopens. */
  async finish(id: string) {
    await this.prisma.event.update({
      where: { id },
      data: { status: 'FINISHED' },
    })
  }

  /**
   * The one event a phone standing here should offer to join. Raw SQL because
   * the ordering is a haversine distance, which Prisma cannot express.
   */
  async findClosestOpen(latitude: number, longitude: number) {
    const rows = await this.prisma.$queryRaw<unknown[]>(closestEventQuery(latitude, longitude))
    const first = rows[0]

    if (!first) return null

    const row = closestEventRowSchema.parse(first)

    return {
      id: row.id,
      name: row.name,
      latitude: row.latitude,
      longitude: row.longitude,
      status: row.status,
      type: row.type,
      userId: row.user_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }
}

/** Raw rows come back in the database's own spelling, and are checked before use. */
const closestEventRowSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  type: z.enum(['TORCH', 'SCREEN']),
  status: z.enum(['OPEN', 'FINISHED']),
  user_id: z.string(),
  created_at: z.date(),
  updated_at: z.date(),
})

/**
 * Closest OPEN event within a ~1km bounding box, ordered by haversine distance.
 * The longitude window degenerates near the poles, where the longitude filter is
 * skipped and the box becomes a latitude band.
 */
function closestEventQuery(latitude: number, longitude: number) {
  return Prisma.sql`
    WITH bounding_box AS (
      SELECT
        CAST(${latitude} AS double precision) AS lat,
        CAST(${longitude} AS double precision) AS lon,
        1 / 111.32 AS lat_diff,
        CASE
          WHEN abs(CAST(${latitude} AS double precision)) < 89
            THEN 1 / (111.32 * cos(radians(CAST(${latitude} AS double precision))))
          ELSE NULL
        END AS lon_diff
    )
    SELECT *
    FROM (
      SELECT e.*,
        (6371 * acos(
          cos(radians(bb.lat)) * cos(radians(e.latitude)) * cos(radians(e.longitude) - radians(bb.lon)) +
          sin(radians(bb.lat)) * sin(radians(e.latitude))
        )) AS distance
      FROM events e
      CROSS JOIN bounding_box bb
      WHERE
        e.status = 'OPEN' AND
        e.latitude BETWEEN (bb.lat - bb.lat_diff) AND (bb.lat + bb.lat_diff) AND
        (bb.lon_diff IS NULL OR e.longitude BETWEEN (bb.lon - bb.lon_diff) AND (bb.lon + bb.lon_diff))
    ) AS candidates
    ORDER BY distance
    LIMIT 1;
  `
}
