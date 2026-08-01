import { buildApp } from './app.js'
import { loadEnv } from './env.js'

const env = loadEnv()
const app = await buildApp({ env })

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    app.log.info({ signal }, 'shutting down')
    await app.close()
    process.exit(0)
  })
}

try {
  await app.listen({ host: env.HOST, port: env.PORT })
  app.log.info(`API docs available at http://localhost:${env.PORT}/docs`)
} catch (error) {
  app.log.error(error)
  process.exit(1)
}
