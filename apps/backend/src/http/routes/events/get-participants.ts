import { participantSchema } from '@pollo/contracts'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import {
  errorExamples,
  errorResponseSchema,
  validationErrorResponseSchema,
} from '../../errors/error-responses.js'
import { NotFoundError } from '../../errors/http-error.js'

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
          'Served from the live connections, so a device appears the instant its `JOIN`',
          'is handled. This is the snapshot a joining device starts from, and the',
          '`USER_JOINED` and `USER_LEFT` frames on its socket are the continuation of',
          'it — open the socket first, then read this, or an arrival in between is lost',
          'to both.',
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

      return reply.send({ participants: event.getSubscribers() })
    },
  )
}
