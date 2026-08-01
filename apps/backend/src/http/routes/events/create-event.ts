import { createEventSchema } from '@pollo/contracts'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { auth } from '../../middlewares/auth.js'
import {
  errorExamples,
  errorResponseSchema,
  validationErrorResponseSchema,
} from '../../responses.js'

export async function createEvent(app: FastifyInstance) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .register(auth)
    .post(
      '/events',
      {
        schema: {
          operationId: 'createEvent',
          tags: ['Event'],
          summary: 'Create an event',
          description: [
            'Opens an event. The caller becomes its admin — the only identity that may',
            'open the admin socket or read the graph. The event is persisted `OPEN` and',
            'registered in the runtime at once, so both sockets accept the new id',
            'immediately.',
            '',
            'The coordinates are the **origin** of the event, not the admin position:',
            'the worker places every pixel relative to this point.',
            '',
            'Closing an event is not exposed over HTTP yet.',
          ].join('\n'),
          security: [{ bearerAuth: [] }],
          body: createEventSchema,
          response: {
            201: z
              .object({ eventId: z.string().uuid().describe('Id of the event just opened.') })
              .describe('Event created, persisted as `OPEN` and live in the runtime.'),
            400: validationErrorResponseSchema.describe('The body did not match the schema.'),
            401: errorResponseSchema.describe('Missing, malformed, or expired bearer token.'),
          },
          examples: {
            body: {
              name: 'Firefly Night',
              latitude: -29.6842,
              longitude: -53.8069,
              type: 'TORCH',
            },
            response: {
              201: { eventId: 'ef46c136-b874-4840-b229-c12e7b1bfa7a' },
              400: {
                message: 'Validation error',
                issues: [
                  {
                    keyword: 'invalid_enum_value',
                    instancePath: '/type',
                    schemaPath: '#/type/invalid_enum_value',
                    params: {
                      issue: {
                        received: 'LASER',
                        code: 'invalid_enum_value',
                        options: ['TORCH', 'SCREEN'],
                        path: ['type'],
                        message:
                          "Invalid enum value. Expected 'TORCH' | 'SCREEN', received 'LASER'",
                      },
                    },
                    message: "Invalid enum value. Expected 'TORCH' | 'SCREEN', received 'LASER'",
                  },
                ],
              },
              401: errorExamples.invalidToken,
            },
          },
        },
      },
      async (request, reply) => {
        const adminId = await request.getCurrentUserId()

        const eventId = await app.events.create({ ...request.body, adminId })

        return reply.status(201).send({ eventId })
      },
    )
}
