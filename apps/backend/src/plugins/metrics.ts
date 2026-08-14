import fastifyPlugin from 'fastify-plugin'
import { isQuiet, Metrics } from '../metrics.js'

/** How often a report is cut. One line a second is readable in a terminal. */
export const REPORT_INTERVAL_MS = 1_000

export interface MetricsPluginOptions {
  intervalMs?: number
}

export const metricsPlugin = fastifyPlugin<MetricsPluginOptions>(
  async (app, options) => {
    const metrics = new Metrics()

    app.decorate('metrics', metrics)

    const timer = setInterval(() => {
      const snapshot = metrics.take()

      if (isQuiet(snapshot)) return

      app.log.info({ metrics: snapshot }, 'metrics')
    }, options.intervalMs ?? REPORT_INTERVAL_MS)

    // The report is a description of a process that is doing something else;
    // it should never be the reason the process stays alive.
    timer.unref?.()

    app.addHook('onClose', async () => {
      clearInterval(timer)
      metrics.stop()
    })
  },
  { name: 'metrics' },
)

declare module 'fastify' {
  interface FastifyInstance {
    metrics: Metrics
  }
}
