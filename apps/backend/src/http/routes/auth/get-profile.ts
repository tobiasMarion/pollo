import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { BadRequestError } from '../../errors.js';
import { auth } from '../../middlewares/auth.js';
import { errorExamples, errorResponseSchema } from '../../responses.js';

export async function getProfile(app: FastifyInstance) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .register(auth)
    .get(
      '/profile',
      {
        schema: {
          operationId: 'getProfile',
          tags: ['Auth'],
          summary: 'Get authenticated user profile',
          description:
            'The user the bearer token belongs to. Doubles as a cheap token check. ' +
            '`name` and `avatarUrl` mirror GitHub at signup time and may be null.',
          security: [{ bearerAuth: [] }],
          response: {
            200: z
              .object({
                user: z.object({
                  id: z.string().uuid().describe('Pollo user id — the `sub` of the JWT.'),
                  name: z.string().nullable().describe('GitHub display name, if any.'),
                  email: z
                    .string()
                    .email()
                    .describe('GitHub email — the identity users are keyed by.'),
                  avatarUrl: z.string().url().nullable().describe('GitHub avatar, if any.'),
                }),
              })
              .describe('The authenticated user.'),
            400: errorResponseSchema.describe(
              'The token is valid but its user no longer exists (deleted account).',
            ),
            401: errorResponseSchema.describe('Missing, malformed, or expired bearer token.'),
          },
          examples: {
            response: {
              200: {
                user: {
                  id: '50f94979-afea-4f09-a2db-2a34bb740614',
                  name: 'Tobias Cadoná Marion',
                  email: 'tobias@example.dev',
                  avatarUrl: 'https://avatars.githubusercontent.com/u/1234567',
                },
              },
              400: { message: 'User not found.' },
              401: errorExamples.invalidToken,
            },
          },
        },
      },
      async (request, reply) => {
        const userId = await request.getCurrentUserId();

        const user = await app.prisma.user.findUnique({
          select: { id: true, name: true, email: true, avatarUrl: true },
          where: { id: userId },
        });

        if (!user) {
          throw new BadRequestError('User not found.');
        }

        return reply.send({ user });
      },
    );
}
