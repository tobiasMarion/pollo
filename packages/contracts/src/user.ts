import { z } from 'zod';

export const userSchema = z
  .object({
    id: z.string().uuid().describe('Pollo user id — the `sub` of the JWT.'),
    name: z.string().nullable().describe('GitHub display name, if any.'),
    email: z.string().email().describe('GitHub email — the identity users are keyed by.'),
    avatarUrl: z.string().url().nullable().describe('GitHub avatar, if any.'),
  })
  .describe('A Pollo account, as it reached us from GitHub at signup time.');

export type User = z.infer<typeof userSchema>;
