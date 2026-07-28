import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { eventSchema } from '../../../schemas/event.js';
import { NotFoundError } from '../../errors.js';

export async function getEvent(app: FastifyInstance) {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/events/:eventId',
    {
      schema: {
        tags: ['Event'],
        summary: 'Get Event by Id',
        params: z.object({
          eventId: z.string().uuid(),
        }),
        response: {
          200: z.object({ event: eventSchema }),
        },
      },
    },
    async (request, reply) => {
      const { eventId } = request.params;

      const event = await app.prisma.event.findUnique({ where: { id: eventId } });

      if (!event) {
        throw new NotFoundError('Event not found');
      }

      return reply.send({ event });
    },
  );
}
