import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createTestApp, createUser, truncateDatabase } from '../helpers.js'

type TestApp = Awaited<ReturnType<typeof createTestApp>>

function stubGithub({ email }: { email: string | null }) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input)

      if (url.startsWith('https://github.com/login/oauth/access_token')) {
        return Response.json({ access_token: 'gh-token', token_type: 'bearer', scope: '' })
      }

      if (url.startsWith('https://api.github.com/user')) {
        return Response.json({
          id: 12345,
          avatar_url: 'https://avatars.test/u/12345',
          name: 'Octo Cat',
          email,
        })
      }

      throw new Error(`Unexpected fetch call in test: ${url}`)
    }),
  )
}

describe('auth routes', () => {
  let app: TestApp

  beforeAll(async () => {
    app = await createTestApp()
    await truncateDatabase(app)
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    await truncateDatabase(app)
  })

  afterAll(async () => {
    await app.close()
  })

  it('POST /sessions/github creates user + account and returns a working JWT', async () => {
    stubGithub({ email: 'octo@test.dev' })

    const response = await app.inject({
      method: 'POST',
      url: '/sessions/github',
      payload: { code: 'oauth-code' },
    })

    expect(response.statusCode).toBe(201)
    const { token } = response.json<{ token: string }>()

    const profile = await app.inject({
      method: 'GET',
      url: '/profile',
      headers: { authorization: `Bearer ${token}` },
    })

    expect(profile.statusCode).toBe(200)
    expect(profile.json().user.email).toBe('octo@test.dev')

    const account = await app.prisma.account.findFirst({ where: { providerAccountId: '12345' } })
    expect(account?.provider).toBe('GITHUB')
  })

  it('POST /sessions/github is idempotent for an existing user', async () => {
    stubGithub({ email: 'octo@test.dev' })

    const first = await app.inject({
      method: 'POST',
      url: '/sessions/github',
      payload: { code: 'code-1' },
    })
    const second = await app.inject({
      method: 'POST',
      url: '/sessions/github',
      payload: { code: 'code-2' },
    })

    expect(first.statusCode).toBe(201)
    expect(second.statusCode).toBe(201)
    expect(await app.prisma.user.count()).toBe(1)
    expect(await app.prisma.account.count()).toBe(1)
  })

  it('POST /sessions/github rejects accounts without a public email', async () => {
    stubGithub({ email: null })

    const response = await app.inject({
      method: 'POST',
      url: '/sessions/github',
      payload: { code: 'oauth-code' },
    })

    expect(response.statusCode).toBe(400)
    expect(response.json().message).toMatch(/email/)
  })

  it('GET /profile rejects missing or invalid tokens', async () => {
    const missing = await app.inject({ method: 'GET', url: '/profile' })
    expect(missing.statusCode).toBe(401)

    const invalid = await app.inject({
      method: 'GET',
      url: '/profile',
      headers: { authorization: 'Bearer not-a-jwt' },
    })
    expect(invalid.statusCode).toBe(401)
  })

  it('GET /profile returns the authenticated user', async () => {
    const { user, token } = await createUser(app)

    const response = await app.inject({
      method: 'GET',
      url: '/profile',
      headers: { authorization: `Bearer ${token}` },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().user).toEqual({
      id: user.id,
      name: user.name,
      email: user.email,
      avatarUrl: null,
    })
  })
})
