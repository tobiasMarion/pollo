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
    return await this.prisma.$transaction(async transaction => {
      // Provider identity is stable; profile email is not. Looking up the
      // account first lets a GitHub user change email without becoming a new
      // Pollo user or colliding with their own account row.
      const account = await transaction.account.findUnique({
        where: { providerAccountId: githubId },
      })

      if (account) {
        return await transaction.user.update({
          where: { id: account.userId },
          data: { name, email, avatarUrl },
        })
      }

      const user =
        (await transaction.user.findUnique({ where: { email } })) ??
        (await transaction.user.create({ data: { name, email, avatarUrl } }))

      await transaction.account.create({
        data: { provider: 'GITHUB', providerAccountId: githubId, userId: user.id },
      })

      return user
    })
  }
}
