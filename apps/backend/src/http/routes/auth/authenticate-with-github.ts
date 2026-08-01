import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { BadRequestError } from '../../errors.js'
import { validationErrorResponseSchema } from '../../responses.js'

const accessTokenResponseSchema = z.object({
  access_token: z.string(),
  token_type: z.literal('bearer'),
  scope: z.string(),
})

const githubUserResponseSchema = z.object({
  id: z.number().int().transform(String),
  avatar_url: z.string(),
  name: z.string().nullable(),
  email: z.string().nullable(),
})

export async function authenticateWithGithub(app: FastifyInstance) {
  app.withTypeProvider<ZodTypeProvider>().post(
    '/sessions/github',
    {
      schema: {
        operationId: 'authenticateWithGithub',
        tags: ['Auth'],
        summary: 'Authenticate with GitHub',
        description: [
          'Exchanges the single-use code from the OAuth redirect for a JWT. Signup and',
          'login are the same call: the user is created on first sight.',
          '',
          'Users are keyed by the GitHub **email**, so an account without one cannot',
          'authenticate. The token carries the user id in `sub` and expires in 7 days.',
        ].join('\n'),
        body: z.object({
          code: z
            .string()
            .describe('The single-use authorization code GitHub put on the redirect URI.'),
        }),
        response: {
          201: z
            .object({
              token: z.string().describe('Signed JWT. `sub` is the user id; expires in 7 days.'),
            })
            .describe('Authenticated. The user was created if this was a first login.'),
          400: validationErrorResponseSchema.describe(
            'The body is missing `code`, GitHub rejected the code, the GitHub ' +
              'profile did not match the expected shape, or the account has no email.',
          ),
        },
        examples: {
          body: { code: '8f4a1c2e9b7d6f0a3e5c' },
          response: {
            201: {
              token:
                'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
                'eyJzdWIiOiI1MGY5NDk3OS1hZmVhLTRmMDktYTJkYi0yYTM0YmI3NDA2MTQifQ.' +
                'Yd0mQ0m2n7cKQhqjJ0lF9r3lY0kFf3sQeM8p9cZ1v2A',
            },
            400: { message: 'Could not exchange the GitHub authorization code.' },
          },
        },
      },
    },
    async (request, reply) => {
      const { code } = request.body
      const { env, prisma } = app

      const oauthUrl = new URL('https://github.com/login/oauth/access_token')
      oauthUrl.searchParams.set('client_id', env.GITHUB_OAUTH_CLIENT_ID)
      oauthUrl.searchParams.set('client_secret', env.GITHUB_OAUTH_CLIENT_SECRET)
      oauthUrl.searchParams.set('redirect_uri', env.GITHUB_OAUTH_CLIENT_REDIRECT_URI)
      oauthUrl.searchParams.set('code', code)

      const tokenResponse = await fetch(oauthUrl, {
        method: 'POST',
        headers: { Accept: 'application/json' },
      })

      const tokenPayload = await tokenResponse.json()
      const tokenResult = accessTokenResponseSchema.safeParse(tokenPayload)

      if (!tokenResult.success) {
        // GitHub answers 200 with `{ error, error_description }` for a reused
        // code, a wrong secret or a redirect_uri that does not match. Without
        // this line every one of them looks identical from the outside.
        request.log.warn({ github: tokenPayload }, 'GitHub token exchange failed')
        throw new BadRequestError('Could not exchange the GitHub authorization code.')
      }

      const userResponse = await fetch('https://api.github.com/user', {
        headers: { Authorization: `Bearer ${tokenResult.data.access_token}` },
      })

      const {
        id: githubId,
        name,
        email,
        avatar_url: avatarUrl,
      } = githubUserResponseSchema.parse(await userResponse.json())

      if (email === null) {
        throw new BadRequestError('Your GitHub account must have an email to authenticate.')
      }

      let user = await prisma.user.findUnique({ where: { email } })

      if (!user) {
        user = await prisma.user.create({
          data: { name, email, avatarUrl },
        })
      }

      const account = await prisma.account.findUnique({
        where: {
          provider_userId: { provider: 'GITHUB', userId: user.id },
        },
      })

      if (!account) {
        await prisma.account.create({
          data: {
            provider: 'GITHUB',
            providerAccountId: githubId,
            userId: user.id,
          },
        })
      }

      const token = await reply.jwtSign({ sub: user.id })

      return reply.status(201).send({ token })
    },
  )
}
