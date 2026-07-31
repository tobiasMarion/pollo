import { eventSchema } from '@pollo/contracts';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { auth } from '../../middlewares/auth.js';
import { errorExamples, errorResponseSchema } from '../../responses.js';

export async function listMyEvents(app: FastifyInstance) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .register(auth)
    .get(
      '/events',
      {
        schema: {
          operationId: 'listMyEvents',
          tags: ['Event'],
          summary: 'List the events you administer',
          description: [
            'Every event created by the authenticated user, newest first, `OPEN` and',
            '`FINISHED` alike. This is what the admin panel lists — discovery for',
            'devices is `GET /events/around` instead.',
            '',
            'Read straight from Postgres, so it answers regardless of what the runtime',
            'currently holds.',
          ].join('\n'),
          security: [{ bearerAuth: [] }],
          response: {
            200: z
              .object({
                events: z.array(eventSchema).describe('Newest first. Empty until you open one.'),
              })
              .describe('The events you administer.'),
            401: errorResponseSchema.describe('Missing, malformed, or expired bearer token.'),
          },
          examples: {
            response: {
              200: {
                events: [
                  {
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
                ],
              },
              401: errorExamples.invalidToken,
            },
          },
        },
      },
      async (request, reply) => {
        const userId = await request.getCurrentUserId();

        const events = await app.prisma.event.findMany({
          where: { userId },
          orderBy: { createdAt: 'desc' },
        });

        return reply.send({ events });
      },
    );
}
