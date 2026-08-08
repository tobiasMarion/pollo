import type { Random } from '../noise/random.js'

/**
 * Which seats are taken, drawn without replacement.
 *
 * A partial Fisher–Yates: only the first `count` positions are settled, so
 * filling a hundred people into a full house costs a hundred swaps rather than a
 * shuffle of the whole plan.
 */
export function occupy(seatCount: number, count: number, random: Random): number[] {
  if (count > seatCount) {
    throw new Error(`The venue holds ${seatCount} seats and ${count} were asked for.`)
  }

  const indices = new Int32Array(seatCount)
  for (let seat = 0; seat < seatCount; seat++) indices[seat] = seat

  const taken: number[] = []

  for (let i = 0; i < count; i++) {
    const pick = i + random.below(seatCount - i)

    const chosen = indices[pick] as number
    indices[pick] = indices[i] as number
    indices[i] = chosen

    taken.push(chosen)
  }

  return taken
}
