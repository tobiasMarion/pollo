import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { errorResponseSchema } from '../responses.js'

export async function healthRoute(app: FastifyInstance) {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/health',
    {
      schema: {
        operationId: 'health',
        tags: ['Meta'],
        summary: 'Health check',
        description:
          'Liveness and readiness in one probe: `SELECT 1` on Postgres, `PING` on ' +
          'Redis. This is what the Docker healthcheck polls.',
        response: {
          200: z
            .object({ status: z.literal('ok') })
            .describe('The API and every datastore it depends on answered.'),
          500: errorResponseSchema.describe('Postgres or Redis did not answer.'),
        },
        examples: {
          response: {
            200: { status: 'ok' },
            500: { message: 'Internal server error.' },
          },
        },
      },
    },
    async (_request, reply) => {
      // Liveness + readiness: fail if any datastore dependency is down.
      if (app.hasDecorator('prisma')) {
        await app.prisma.$queryRaw`SELECT 1`
      }

      if (app.hasDecorator('redis')) {
        await app.redis.ping()
      }

      return reply.send({ status: 'ok' })
    },
  )
}
