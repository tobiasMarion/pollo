import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { locationSchema } from '../../../schemas/location.js';
import { NotFoundError } from '../../errors.js';

export async function getParticipants(app: FastifyInstance) {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/events/:eventId/participants',
    {
      schema: {
        tags: ['Event'],
        summary: "Get Event's participants",
        params: z.object({
          eventId: z.string().uuid(),
        }),
        response: {
          200: z.object({
            participants: z.array(
              z.object({
                deviceId: z.string(),
                location: locationSchema,
              }),
            ),
          }),
        },
      },
    },
    async (request, reply) => {
      const event = app.events.get(request.params.eventId);

      if (!event) {
        throw new NotFoundError('Event not found');
      }

      const participants = await event.getSubscribers();

      return reply.send({ participants });
    },
  );
}
