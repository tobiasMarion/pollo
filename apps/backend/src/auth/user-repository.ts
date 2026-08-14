import type { PrismaClient } from '../generated/prisma/client.js'

interface GithubIdentity {
  githubId: string
  /** GitHub lets a profile have no display name. */
  name: string | null
  email: string
  avatarUrl: string
}

/**
 * The `users` table and the `accounts` rows that hang off it — one aggregate,
 * since an account is never read on its own.
 */
export class UserRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /** The profile a signed-in user is allowed to see of themselves. */
  async findProfile(id: string) {
    return await this.prisma.user.findUnique({
      select: { id: true, name: true, email: true, avatarUrl: true },
      where: { id },
    })
  }

  /**
   * Finds or creates the user behind a GitHub identity and records the link.
   * One method, because the three states it covers only make sense together.
   */
  async upsertFromGithub({ githubId, name, email, avatarUrl }: GithubIdentity) {
    const user =
      (await this.prisma.user.findUnique({ where: { email } })) ??
      (await this.prisma.user.create({ data: { name, email, avatarUrl } }))

    const account = await this.prisma.account.findUnique({
      where: { provider_userId: { provider: 'GITHUB', userId: user.id } },
    })

    if (!account) {
      await this.prisma.account.create({
        data: { provider: 'GITHUB', providerAccountId: githubId, userId: user.id },
      })
    }

    return user
  }
}
