import fastifyCors from '@fastify/cors';
import fastifyJwt from '@fastify/jwt';
import fastifySwagger from '@fastify/swagger';
import scalarApiReference from '@scalar/fastify-api-reference';
import { fastify } from 'fastify';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import type { Env } from './env.js';
import { errorHandler } from './http/error-handler.js';
import { healthRoute } from './http/routes/health.js';
import { createLogger, type Logger } from './logger.js';
import { prismaPlugin } from './plugins/prisma.js';
import { redisPlugin } from './plugins/redis.js';

export interface BuildAppOptions {
  env: Env;
  logger?: Logger;
  /** Test overrides — production wiring creates real clients from env. */
  prisma?: PrismaClient;
  redis?: Redis;
}

export async function buildApp({ env, logger, prisma, redis }: BuildAppOptions) {
  const app = fastify({
    loggerInstance: logger ?? createLogger(env),
  }).withTypeProvider<ZodTypeProvider>();

  app.decorate('env', env);

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler(errorHandler);

  await app.register(fastifyCors, { origin: true });
  await app.register(fastifyJwt, {
    secret: env.JWT_SECRET,
    sign: { expiresIn: '7d' },
  });

  await app.register(fastifySwagger, {
    openapi: {
      info: {
        title: 'Pollo API',
        description: 'An app to sync a million fireflies',
        version: '1.0.0',
      },
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
        },
      },
    },
    transform: jsonSchemaTransform,
  });
  await app.register(scalarApiReference, { routePrefix: '/docs' });

  await app.register(prismaPlugin, { client: prisma });
  await app.register(redisPlugin, { client: redis });

  await app.register(healthRoute);

  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;

declare module 'fastify' {
  interface FastifyInstance {
    env: Env;
  }
}
