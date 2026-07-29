import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { Prisma } from '../../../generated/prisma/client.js';
import { eventSchema } from '../../../schemas/event.js';
import { NotFoundError } from '../../errors.js';
import { errorResponseSchema, validationErrorResponseSchema } from '../../responses.js';

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
        operationId: 'getEventAround',
        tags: ['Event'],
        summary: 'Find the closest event around a location',
        description: [
          'Discovery for devices: the one event a phone should offer to join. Public.',
          '',
          'Only `OPEN` events count. Candidates are narrowed by a **~1 km bounding',
          'box**, then ordered by haversine distance; the nearest wins. Near the poles',
          '(|latitude| ≥ 89) the longitude filter is dropped and the box becomes a',
          'latitude band.',
        ].join('\n'),
        querystring: z.object({
          latitude: z.coerce.number().min(-90).max(90).describe('Where the device is.'),
          longitude: z.coerce.number().min(-180).max(180).describe('Where the device is.'),
        }),
        response: {
          200: z.object({ event: eventSchema }).describe('The closest open event within ~1 km.'),
          400: validationErrorResponseSchema.describe(
            'A coordinate is missing, not a number, or out of range.',
          ),
          404: errorResponseSchema.describe('No open event sits within ~1 km of that point.'),
        },
        examples: {
          querystring: { latitude: -29.6845, longitude: -53.8069 },
          response: {
            200: {
              event: {
                id: 'ef46c136-b874-4840-b229-c12e7b1bfa7a',
                type: 'TORCH',
                name: 'Firefly Night',
                status: 'OPEN',
                latitude: -29.6842,
                longitude: -53.8069,
                userId: '50f94979-afea-4f09-a2db-2a34bb740614',
                createdAt: '2026-07-28T23:45:08.169Z',
                updatedAt: '2026-07-28T23:45:08.169Z',
              },
            },
            400: {
              message: 'Validation error',
              issues: [
                {
                  keyword: 'invalid_type',
                  instancePath: '/latitude',
                  schemaPath: '#/latitude/invalid_type',
                  params: {
                    issue: {
                      code: 'invalid_type',
                      expected: 'number',
                      received: 'nan',
                      path: ['latitude'],
                      message: 'Expected number, received nan',
                    },
                  },
                  message: 'Expected number, received nan',
                },
              ],
            },
            404: { message: 'There was not any event around you.' },
          },
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
