import { z } from 'zod'

type Option<Discriminator extends string> = z.ZodDiscriminatedUnionOption<Discriminator>

/**
 * A discriminated union built from a record instead of a hand-written member
 * list, so adding a member is a single entry: the union, the type inferred from
 * it and every list derived from the keys all follow.
 */
export function unionFrom<
  Discriminator extends string,
  Members extends Record<string, Option<Discriminator>>,
>(discriminator: Discriminator, members: Members) {
  // Zod wants a non-empty tuple and `Object.values` can only promise an array.
  // This is the one cast the derivation rests on; `z.infer` of the result is
  // still the union of every member, so nothing is lost downstream.
  const options = Object.values(members) as unknown as [
    Members[keyof Members],
    ...Members[keyof Members][],
  ]

  return z.discriminatedUnion(discriminator, options)
}

/** The named subset of a record — how the per-direction unions are built. */
export function subsetOf<
  Members extends Record<string, unknown>,
  const Keys extends readonly (keyof Members)[],
>(members: Members, keys: Keys): Pick<Members, Keys[number]> {
  const entries = keys.map(key => [key, members[key]] as const)

  return Object.fromEntries(entries) as Pick<Members, Keys[number]>
}
