import fastifyPlugin from 'fastify-plugin'
import { UserRepository } from '../auth/user-repository.js'
import { EventRepository } from '../events/postgres/event-repository.js'

/** The only place a `PrismaClient` is handed to anything. */
export const repositoriesPlugin = fastifyPlugin(
  async app => {
    app.decorate('eventRepository', new EventRepository(app.prisma))
    app.decorate('userRepository', new UserRepository(app.prisma))
  },
  { name: 'repositories', dependencies: ['prisma'] },
)

declare module 'fastify' {
  interface FastifyInstance {
    eventRepository: EventRepository
    userRepository: UserRepository
  }
}
