import fastifyCors from '@fastify/cors';
import fastifyJwt from '@fastify/jwt';
import fastifySwagger from '@fastify/swagger';
import fastifyWebsocket from '@fastify/websocket';
import scalarApiReference from '@scalar/fastify-api-reference';
import { fastify } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { Redis } from 'ioredis';
import type { Env } from './env.js';
import type { Bus } from './events/bus.js';
import type { PrismaClient } from './generated/prisma/client.js';
import { errorHandler } from './http/error-handler.js';
import { openapiTransform } from './http/openapi.js';
import { routes } from './http/routes/index.js';
import { createLogger, type Logger } from './logger.js';
import { eventsRuntimePlugin } from './plugins/events-runtime.js';
import { prismaPlugin } from './plugins/prisma.js';
import { redisPlugin } from './plugins/redis.js';

export interface BuildAppOptions {
  env: Env;
  logger?: Logger;
  /** Test overrides — production wiring creates real clients from env. */
  prisma?: PrismaClient;
  redis?: Redis;
  bus?: Bus;
}

export async function buildApp({ env, logger, prisma, redis, bus }: BuildAppOptions) {
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
        description: [
          'Sync a million fireflies. Each device is a pixel; REST opens and discovers',
          'events, the WebSockets carry them while they run. Positions come from the',
          'Rust worker over Redis Streams — this API does no simulation of its own.',
          '',
          '### Authentication',
          '',
          '`POST /sessions/github` returns a JWT; send it as `Authorization: Bearer',
          '<token>` (valid 7 days). The admin WebSocket takes it in its first frame',
          'instead, since a header is not an option on upgrade.',
          '',
          '### Errors',
          '',
          'Every failure is JSON with a `message`; schema failures add `issues`.',
          'Validation runs **before** authentication, so a malformed unauthenticated',
          'request answers `400`, not `401`. A `404` may also mean "not yours".',
          '',
          'Runtime-backed routes (`/participants`, `/graph`, both sockets) only answer',
          'while an event is `OPEN`. Sockets close with a `44xx` code instead of these.',
        ].join('\n'),
        version: '1.0.0',
      },
      servers: [{ url: `http://localhost:${env.PORT}`, description: 'Local development' }],
      tags: [
        { name: 'Meta', description: 'Service health.' },
        { name: 'Auth', description: 'GitHub OAuth sign-in and the authenticated user.' },
        { name: 'Event', description: 'Opening, discovering and running events.' },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
            description: 'JWT returned by `POST /sessions/github`.',
          },
        },
      },
    },
    transform: openapiTransform,
  });
  await app.register(scalarApiReference, {
    routePrefix: '/docs',
    configuration: {
      title: 'Pollo API',
      slug: 'pollo-api',
      pageTitle: 'Pollo API',
      theme: 'saturn',
      layout: 'modern',
      operationTitleSource: 'summary',
      defaultOpenAllTags: true,
      defaultOpenFirstTag: true,
      // The reference is a debugging surface in development and a plain reference
      // in production, so the tooling only shows up on localhost.
      showDeveloperTools: 'localhost',
      showToolbar: 'localhost',
      showSidebar: true,
      hideSearch: false,
      hideModels: false,
      hideClientButton: false,
      hideTestRequestButton: false,
      hideDarkModeToggle: false,
      showOperationId: false,
      modelsSectionLabel: 'Models',
      documentDownloadType: 'both',
      orderSchemaPropertiesBy: 'alpha',
      orderRequiredPropertiesFirst: true,
      expandAllModelSections: false,
      expandAllResponses: false,
      expandAllSchemaProperties: false,
      // Never keep a bearer token in browser storage — the reference is served
      // from the same origin as the API.
      persistAuth: false,
      withDefaultFonts: true,
      isEditable: false,
    },
  });
  await app.register(fastifyWebsocket);

  await app.register(prismaPlugin, { client: prisma });
  await app.register(redisPlugin, { client: redis });
  await app.register(eventsRuntimePlugin, { bus });

  await app.register(routes);

  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;

declare module 'fastify' {
  interface FastifyInstance {
    env: Env;
  }
}
