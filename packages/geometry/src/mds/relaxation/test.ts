import { describe, expect, it } from 'vitest'
import { Relaxation } from './index.js'

/** Folds a series of answers in at whatever step the relaxation asks for. */
function absorb(relaxation: Relaxation, slot: number, answers: readonly number[]) {
  let held = 0

  for (const answer of answers) {
    relaxation.noteMeasurement(slot)
    held += (answer - held) * relaxation.stepFor(slot)
  }

  return held
}

describe('Relaxation', () => {
  /**
   * The property the whole thing rests on: blending the nth answer in at weight
   * `1/n` is not an approximation of the arithmetic mean, it *is* the mean — one
   * counter per device, no history kept.
   */
  it('is exactly the arithmetic mean of the answers it was given', () => {
    const answers = [3, 9, 1, 7, 4, 12, 8, 2]
    const mean = answers.reduce((total, value) => total + value, 0) / answers.length

    // No floor in the way: `alphaMin` below `1 / count` leaves the true mean.
    expect(absorb(new Relaxation({ alphaMin: 1e-9 }), 0, answers)).toBeCloseTo(mean, 12)
  })

  /**
   * A newcomer adopts its answer whole. A device with a slow first step would
   * crawl to its place from wherever it started, which is nowhere.
   */
  it('adopts the first answer in full', () => {
    const relaxation = new Relaxation({ alphaMin: 0.2 })

    relaxation.noteMeasurement(0)

    expect(relaxation.stepFor(0)).toBe(1)
    expect(absorb(new Relaxation({ alphaMin: 1e-9 }), 0, [17])).toBe(17)
  })

  it('has no opinion about a slot nothing has ever told it about', () => {
    expect(new Relaxation({ alphaMin: 0.2 }).stepFor(4)).toBe(1)
    expect(new Relaxation({ alphaMin: 0.2 }).evidenceAt(4)).toBe(0)
  })

  /**
   * Past `1 / alphaMin` windows this stops being a true mean and becomes an
   * exponential average over that many — which is the only reason a device whose
   * owner walks away is ever followed.
   */
  it('stops shrinking the step once it hits the floor', () => {
    const relaxation = new Relaxation({ alphaMin: 0.2 })

    for (let window = 0; window < 100; window++) relaxation.noteMeasurement(0)

    expect(relaxation.stepFor(0)).toBe(0.2)
    expect(relaxation.evidenceAt(0)).toBe(100)
  })

  it('tracks a value that moved, rather than holding it where it was found', () => {
    const relaxation = new Relaxation({ alphaMin: 0.2 })

    // Settled on zero over fifty windows, then the answer jumps to ten.
    absorb(
      relaxation,
      0,
      Array.from({ length: 50 }, () => 0),
    )

    let held = 0

    for (let window = 0; window < 20; window++) {
      relaxation.noteMeasurement(0)
      held += (10 - held) * relaxation.stepFor(0)
    }

    expect(held).toBeGreaterThan(9.8)
  })

  /** A freed slot's history belongs to its previous tenant. */
  it('forgets a slot handed on to somebody else', () => {
    const relaxation = new Relaxation({ alphaMin: 0.2 })

    for (let window = 0; window < 10; window++) relaxation.noteMeasurement(3)
    relaxation.forget(3)

    expect(relaxation.evidenceAt(3)).toBe(0)
    expect(relaxation.stepFor(3)).toBe(1)
  })

  it('grows to hold a slot beyond the capacity it started with', () => {
    const relaxation = new Relaxation({ alphaMin: 0.2 })

    relaxation.noteMeasurement(0)
    relaxation.noteMeasurement(5_000)
    relaxation.forget(9_001)

    expect(relaxation.evidenceAt(5_000)).toBe(1)
    expect(relaxation.evidenceAt(9_001)).toBe(0)
    // Nothing already counted is lost on the way.
    expect(relaxation.evidenceAt(0)).toBe(1)
  })
})
