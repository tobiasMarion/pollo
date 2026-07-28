import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { BadRequestError } from '../../errors.js';

const accessTokenResponseSchema = z.object({
  access_token: z.string(),
  token_type: z.literal('bearer'),
  scope: z.string(),
});

const githubUserResponseSchema = z.object({
  id: z.number().int().transform(String),
  avatar_url: z.string(),
  name: z.string().nullable(),
  email: z.string().nullable(),
});

export async function authenticateWithGithub(app: FastifyInstance) {
  app.withTypeProvider<ZodTypeProvider>().post(
    '/sessions/github',
    {
      schema: {
        tags: ['Auth'],
        summary: 'Authenticate with GitHub',
        description: 'Exchanges a GitHub OAuth authorization code for a JWT.',
        body: z.object({
          code: z.string(),
        }),
        response: {
          201: z.object({ token: z.string() }),
        },
      },
    },
    async (request, reply) => {
      const { code } = request.body;
      const { env, prisma } = app;

      const oauthUrl = new URL('https://github.com/login/oauth/access_token');
      oauthUrl.searchParams.set('client_id', env.GITHUB_OAUTH_CLIENT_ID);
      oauthUrl.searchParams.set('client_secret', env.GITHUB_OAUTH_CLIENT_SECRET);
      oauthUrl.searchParams.set('redirect_uri', env.GITHUB_OAUTH_CLIENT_REDIRECT_URI);
      oauthUrl.searchParams.set('code', code);

      const tokenResponse = await fetch(oauthUrl, {
        method: 'POST',
        headers: { Accept: 'application/json' },
      });

      const tokenResult = accessTokenResponseSchema.safeParse(await tokenResponse.json());

      if (!tokenResult.success) {
        throw new BadRequestError('Could not exchange the GitHub authorization code.');
      }

      const userResponse = await fetch('https://api.github.com/user', {
        headers: { Authorization: `Bearer ${tokenResult.data.access_token}` },
      });

      const {
        id: githubId,
        name,
        email,
        avatar_url: avatarUrl,
      } = githubUserResponseSchema.parse(await userResponse.json());

      if (email === null) {
        throw new BadRequestError('Your GitHub account must have an email to authenticate.');
      }

      let user = await prisma.user.findUnique({ where: { email } });

      if (!user) {
        user = await prisma.user.create({
          data: { name, email, avatarUrl },
        });
      }

      const account = await prisma.account.findUnique({
        where: {
          provider_userId: { provider: 'GITHUB', userId: user.id },
        },
      });

      if (!account) {
        await prisma.account.create({
          data: {
            provider: 'GITHUB',
            providerAccountId: githubId,
            userId: user.id,
          },
        });
      }

      const token = await reply.jwtSign({ sub: user.id });

      return reply.status(201).send({ token });
    },
  );
}
