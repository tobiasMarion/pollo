import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { createEventSchema } from '../../../schemas/event.js';
import { auth } from '../../middlewares/auth.js';

export async function createEvent(app: FastifyInstance) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .register(auth)
    .post(
      '/events',
      {
        schema: {
          tags: ['Event'],
          summary: 'Create Event',
          security: [{ bearerAuth: [] }],
          body: createEventSchema,
          response: {
            201: z.object({ eventId: z.string().uuid() }),
          },
        },
      },
      async (request, reply) => {
        const adminId = await request.getCurrentUserId();

        const eventId = await app.events.create({ ...request.body, adminId });

        return reply.status(201).send({ eventId });
      },
    );
}
