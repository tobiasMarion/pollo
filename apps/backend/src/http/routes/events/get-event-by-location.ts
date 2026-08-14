import { eventSchema } from '@pollo/contracts'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { errorResponseSchema, validationErrorResponseSchema } from '../../errors/error-responses.js'
import { NotFoundError } from '../../errors/http-error.js'

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
      const event = await app.eventRepository.findClosestOpen(query.latitude, query.longitude)

      if (!event) {
        throw new NotFoundError('There was not any event around you.')
      }

      return reply.send({ event })
    },
  )
}
