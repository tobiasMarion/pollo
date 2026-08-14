import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

const summarySchema = z.object({
  count: z.number(),
  total: z.number(),
  max: z.number(),
  mean: z.number(),
})

export async function metricsRoute(app: FastifyInstance) {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/metrics',
    {
      schema: {
        operationId: 'metrics',
        tags: ['Meta'],
        summary: 'The last throughput report',
        description: [
          'Frames in and out, live connections, work still queued and how late the',
          'event loop is running. Public, because none of it names a device or a user.',
          '',
          'This is the **last report the server cut**, not a fresh reading: the window',
          'belongs to the reporter, so polling this cannot shorten it and two readers',
          'cannot disagree. Expect it to be up to a second old, and `null` until the',
          'first window closes.',
          '',
          'Read `rates` rather than `counters` — the same totals divided by the window.',
          'The number that matters under load is `gauges.pendingWrites`: if it climbs',
          'and does not come back down, the store is losing the race and everything',
          'else you are about to read is a symptom of that.',
        ].join('\n'),
        response: {
          200: z
            .object({
              window: z.number().describe('Milliseconds the counts were accumulated over.'),
              counters: z.record(z.number()).describe('Raw totals for the window.'),
              rates: z.record(z.number()).describe('The same totals per second.'),
              summaries: z.record(summarySchema),
              gauges: z.record(z.number()).describe('Values read at the moment of the cut.'),
              eventLoop: z
                .object({
                  mean: z.number(),
                  p50: z.number(),
                  p99: z.number(),
                  max: z.number(),
                })
                .describe('Milliseconds the loop ran late by.'),
            })
            .nullable()
            .describe('The last report, or null before the first window closed.'),
        },
      },
    },
    async (_request, reply) => {
      return reply.send(app.metrics.latest())
    },
  )
}
