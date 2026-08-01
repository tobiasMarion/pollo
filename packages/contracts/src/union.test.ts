import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { subsetOf, unionFrom } from './union.js'

const members = {
  A: z.object({ kind: z.literal('A'), a: z.number() }),
  B: z.object({ kind: z.literal('B'), b: z.string() }),
  C: z.object({ kind: z.literal('C'), c: z.boolean() }),
} as const

describe('unionFrom', () => {
  const union = unionFrom('kind', members)

  it('accepts every member of the record', () => {
    expect(union.parse({ kind: 'A', a: 1 })).toEqual({ kind: 'A', a: 1 })
    expect(union.parse({ kind: 'B', b: 'ok' })).toEqual({ kind: 'B', b: 'ok' })
    expect(union.parse({ kind: 'C', c: true })).toEqual({ kind: 'C', c: true })
  })

  it('rejects an unknown discriminator', () => {
    expect(union.safeParse({ kind: 'D' }).success).toBe(false)
  })

  it('rejects a member whose payload does not match', () => {
    expect(union.safeParse({ kind: 'A', a: 'not a number' }).success).toBe(false)
  })

  it('infers the union of every member', () => {
    // The assignments are the assertion: they only compile if the derived type
    // reaches each member's own payload rather than collapsing to the first.
    const a: z.infer<typeof union> = { kind: 'A', a: 1 }
    const b: z.infer<typeof union> = { kind: 'B', b: 'ok' }
    const c: z.infer<typeof union> = { kind: 'C', c: true }

    expect([a, b, c]).toHaveLength(3)
  })
})

describe('subsetOf', () => {
  const pair = subsetOf(members, ['A', 'C'])
  const union = unionFrom('kind', pair)

  it('keeps the named members', () => {
    expect(Object.keys(pair)).toEqual(['A', 'C'])
    expect(union.parse({ kind: 'C', c: false })).toEqual({ kind: 'C', c: false })
  })

  it('rejects a member left out of the subset', () => {
    expect(union.safeParse({ kind: 'B', b: 'ok' }).success).toBe(false)
  })

  it('narrows the inferred type to the subset', () => {
    const a: z.infer<typeof union> = { kind: 'A', a: 1 }
    // @ts-expect-error `B` is not part of this subset
    const b: z.infer<typeof union> = { kind: 'B', b: 'ok' }

    expect([a, b]).toHaveLength(2)
  })
})
