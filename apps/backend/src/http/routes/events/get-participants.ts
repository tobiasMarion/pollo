import { participantSchema } from '@pollo/contracts'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { NotFoundError } from '../../errors.js'
import {
  errorExamples,
  errorResponseSchema,
  validationErrorResponseSchema,
} from '../../responses.js'

export async function getParticipants(app: FastifyInstance) {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/events/:eventId/participants',
    {
      schema: {
        operationId: 'getParticipants',
        tags: ['Event'],
        summary: 'List the devices currently in an event',
        description: [
          'Devices that joined and have not left, with their last reported location.',
          'Public.',
          '',
          'Served from the Redis graph store, whose writes are queued off the hot path:',
          'a device that just sent `JOIN` may take a moment to appear. Poll, do not',
          'assume.',
        ].join('\n'),
        params: z.object({
          eventId: z.string().uuid().describe('Id of an open event.'),
        }),
        response: {
          200: z
            .object({ participants: z.array(participantSchema) })
            .describe('The devices in the event. Empty until someone joins.'),
          400: validationErrorResponseSchema.describe('`eventId` is not a valid UUID.'),
          404: errorResponseSchema.describe('No open event with that id is live in the runtime.'),
        },
        examples: {
          params: { eventId: 'ef46c136-b874-4840-b229-c12e7b1bfa7a' },
          response: {
            200: {
              participants: [
                {
                  deviceId: 'device-1',
                  location: {
                    latitude: -29.6842,
                    longitude: -53.8069,
                    horizontalAccuracy: 5,
                    altitude: 100,
                    verticalAccuracy: 3,
                  },
                },
              ],
            },
            400: errorExamples.invalidUuid,
            404: errorExamples.eventNotFound,
          },
        },
      },
    },
    async (request, reply) => {
      const event = app.events.get(request.params.eventId)

      if (!event) {
        throw new NotFoundError('Event not found')
      }

      const participants = await event.getSubscribers()

      return reply.send({ participants })
    },
  )
}
