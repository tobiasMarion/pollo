import { eventGraphSchema } from '@pollo/contracts';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { NotFoundError } from '../../errors.js';
import { auth } from '../../middlewares/auth.js';
import {
  errorExamples,
  errorResponseSchema,
  validationErrorResponseSchema,
} from '../../responses.js';

export async function getEventGraph(app: FastifyInstance) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .register(auth)
    .get(
      '/events/:eventId/graph',
      {
        schema: {
          operationId: 'getEventGraph',
          tags: ['Event'],
          summary: 'Get the distance graph of an event',
          description: [
            'Snapshot of the event as the runtime knows it: every device (`nodes`, with',
            'last location and position) and every distance between them (`edges`).',
            '',
            'Restricted to the admin **of that event**; anyone else gets `404`, not',
            '`403`, so the response never reveals that an event exists.',
            '',
            'Lives in Redis with a 12-hour TTL. `position` is absent until the worker',
            'publishes one. Edges are directed, and going out of range removes the edge',
            'rather than zeroing it.',
          ].join('\n'),
          security: [{ bearerAuth: [] }],
          params: z.object({
            eventId: z.string().uuid().describe('Id of an open event you administer.'),
          }),
          response: {
            200: eventGraphSchema,
            400: validationErrorResponseSchema.describe('`eventId` is not a valid UUID.'),
            401: errorResponseSchema.describe('Missing, malformed, or expired bearer token.'),
            404: errorResponseSchema.describe(
              'No open event with that id — or you are not its admin.',
            ),
          },
          examples: {
            params: { eventId: 'ef46c136-b874-4840-b229-c12e7b1bfa7a' },
            response: {
              200: {
                nodes: {
                  'device-1': {
                    location: {
                      latitude: -29.6842,
                      longitude: -53.8069,
                      horizontalAccuracy: 5,
                      altitude: 100,
                      verticalAccuracy: 3,
                    },
                    position: {
                      uncorrected: {
                        relative: { x: 0, y: 0, z: 0 },
                        absolute: { x: 1, y: 1, z: 1 },
                      },
                      simulated: {
                        relative: { x: 0.5, y: 0.5, z: 0 },
                        absolute: { x: 1.5, y: 1.5, z: 1 },
                      },
                    },
                  },
                },
                edges: [{ from: 'device-1', to: 'device-2', value: 3.2 }],
              },
              400: errorExamples.invalidUuid,
              401: errorExamples.invalidToken,
              404: errorExamples.eventNotFound,
            },
          },
        },
      },
      async (request, reply) => {
        const userId = await request.getCurrentUserId();

        const event = app.events.get(request.params.eventId);

        if (!event || event.getAdminId() !== userId) {
          throw new NotFoundError('Event not found');
        }

        const graph = await event.getEventGraph();

        return reply.send(graph);
      },
    );
}
