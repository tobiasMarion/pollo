import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { edgeSchema, metadataSchema } from '../../../schemas/graph.js';
import { NotFoundError } from '../../errors.js';
import { auth } from '../../middlewares/auth.js';

export async function getEventGraph(app: FastifyInstance) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .register(auth)
    .get(
      '/events/:eventId/graph',
      {
        schema: {
          tags: ['Event'],
          summary: 'Get Event Graph',
          security: [{ bearerAuth: [] }],
          params: z.object({
            eventId: z.string().uuid(),
          }),
          response: {
            200: z.object({
              nodes: z.record(metadataSchema),
              edges: z.array(edgeSchema),
            }),
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
