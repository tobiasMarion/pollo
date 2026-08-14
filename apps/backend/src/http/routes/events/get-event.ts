import { eventSchema } from '@pollo/contracts'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import {
  errorExamples,
  errorResponseSchema,
  validationErrorResponseSchema,
} from '../../errors/error-responses.js'
import { NotFoundError } from '../../errors/http-error.js'

export async function getEvent(app: FastifyInstance) {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/events/:eventId',
    {
      schema: {
        operationId: 'getEvent',
        tags: ['Event'],
        summary: 'Get an event by id',
        description:
          'Reads the event from Postgres. Public, and the only event route that ' +
          'still answers once the event is `FINISHED`.',
        params: z.object({
          eventId: z.string().uuid().describe('Id returned by `POST /events`.'),
        }),
        response: {
          200: z.object({ event: eventSchema }).describe('The event.'),
          400: validationErrorResponseSchema.describe('`eventId` is not a valid UUID.'),
          404: errorResponseSchema.describe('No event exists with that id.'),
        },
        examples: {
          params: { eventId: 'ef46c136-b874-4840-b229-c12e7b1bfa7a' },
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
            400: errorExamples.invalidUuid,
            404: errorExamples.eventNotFound,
          },
        },
      },
    },
    async (request, reply) => {
      const { eventId } = request.params

      const event = await app.eventRepository.findById(eventId)

      if (!event) {
        throw new NotFoundError('Event not found')
      }

      return reply.send({ event })
    },
  )
}
