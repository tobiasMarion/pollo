import fastifyPlugin from 'fastify-plugin'
import { UnauthorizedError } from '../errors/http-error.js'

export const auth = fastifyPlugin(
  async app => {
    app.addHook('preHandler', async request => {
      request.getCurrentUserId = async () => {
        try {
          const { sub } = await request.jwtVerify<{ sub: string }>()
          return sub
        } catch {
          throw new UnauthorizedError('Invalid auth token')
        }
      }
    })
  },
  { name: 'auth' },
)

declare module 'fastify' {
  interface FastifyRequest {
    getCurrentUserId(): Promise<string>
  }
}
