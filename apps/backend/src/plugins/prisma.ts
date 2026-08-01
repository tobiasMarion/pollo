import { PrismaPg } from '@prisma/adapter-pg'
import fastifyPlugin from 'fastify-plugin'
import { PrismaClient } from '../generated/prisma/client.js'

export interface PrismaPluginOptions {
  client?: PrismaClient
}

export const prismaPlugin = fastifyPlugin<PrismaPluginOptions>(
  async (app, options) => {
    const prisma =
      options.client ??
      new PrismaClient({
        adapter: new PrismaPg({ connectionString: app.env.DATABASE_URL }),
      })

    app.decorate('prisma', prisma)

    app.addHook('onClose', async () => {
      await prisma.$disconnect()
    })
  },
  { name: 'prisma' },
)

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient
  }
}
