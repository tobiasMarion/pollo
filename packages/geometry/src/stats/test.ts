import { describe, expect, it } from 'vitest'
import { median } from './index.js'

describe('median', () => {
  it('takes the middle of an odd count and the mean of the two middles of an even one', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 3, 2])).toBe(2.5)
  })

  it('does not need its input sorted, and does not sort it', () => {
    const values = [9, 1, 5]

    expect(median(values)).toBe(5)
    expect(values).toEqual([9, 1, 5])
  })

  it('says zero when it has been given nothing', () => {
    expect(median([])).toBe(0)
  })

  /** The whole reason it is here: one absurd sample moves a mean and not this. */
  it('ignores a sample that is not noise at all', () => {
    expect(median([1, 2, 3, 4, 10_000])).toBe(3)
  })
})
