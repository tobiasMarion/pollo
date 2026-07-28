import { PrismaClient } from '@prisma/client';
import fastifyPlugin from 'fastify-plugin';

export interface PrismaPluginOptions {
  client?: PrismaClient;
}

export const prismaPlugin = fastifyPlugin<PrismaPluginOptions>(
  async (app, options) => {
    const prisma = options.client ?? new PrismaClient();

    app.decorate('prisma', prisma);

    app.addHook('onClose', async () => {
      await prisma.$disconnect();
    });
  },
  { name: 'prisma' },
);

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}
