import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

export async function healthRoute(app: FastifyInstance) {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/health',
    {
      schema: {
        tags: ['Meta'],
        summary: 'Health check',
        response: {
          200: z.object({ status: z.literal('ok') }),
        },
      },
    },
    async (_request, reply) => {
      // Liveness + readiness: fail if any datastore dependency is down.
      if (app.hasDecorator('prisma')) {
        await app.prisma.$queryRaw`SELECT 1`;
      }

      if (app.hasDecorator('redis')) {
        await app.redis.ping();
      }

      return reply.send({ status: 'ok' });
    },
  );
}
