import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { Prisma } from '../../../generated/prisma/client.js';
import { eventSchema } from '../../../schemas/event.js';
import { NotFoundError } from '../../errors.js';

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
});

/**
 * Closest OPEN event within a ~1km bounding box, ordered by haversine
 * distance. The longitude window degenerates near the poles, where the
 * longitude filter is skipped.
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
  `;
}

export async function getEventByLocation(app: FastifyInstance) {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/events/around',
    {
      schema: {
        tags: ['Event'],
        summary: 'Get Event Around',
        querystring: z.object({
          latitude: z.coerce.number().min(-90).max(90),
          longitude: z.coerce.number().min(-180).max(180),
        }),
        response: {
          200: z.object({ event: eventSchema }),
        },
      },
    },
    async ({ query }, reply) => {
      const rows = await app.prisma.$queryRaw<unknown[]>(
        closestEventQuery(query.latitude, query.longitude),
      );

      const first = rows[0];

      if (!first) {
        throw new NotFoundError('There was not any event around you.');
      }

      const row = closestEventRowSchema.parse(first);

      return reply.send({
        event: {
          id: row.id,
          name: row.name,
          latitude: row.latitude,
          longitude: row.longitude,
          status: row.status,
          type: row.type,
          userId: row.user_id,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        },
      });
    },
  );
}
