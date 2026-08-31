const INITIAL_CAPACITY = 256

export interface RelaxationOptions {
  /**
   * How far the step is allowed to shrink, and therefore the only dial here.
   * It sets two things at once, which is why there is nothing else to turn: the
   * mean settles over `1 / alphaMin` windows, and a device that moves is caught
   * up with over that same number. More averaging is more lag, and they are the
   * same number because they are the same mechanism.
   */
  alphaMin: number
}

/**
 * How much of each freshly solved answer a device actually adopts.
 *
 * Without this a solver re-answers the snapshot every window: it solves the
 * measurements that just arrived, publishes them, and forgets them. Doing that
 * four times a second gets four independent looks at a standing crowd every
 * second and keeps exactly one of them.
 *
 * Taking a **fraction** of the way to each new answer turns a device into a
 * running average over those looks. `alpha = 1/n` is not an approximation of
 * that average, it is that average: blending the nth answer in at weight `1/n`
 * leaves exactly the arithmetic mean of all n of them. That is the cheapest
 * possible way to average — one counter per device, no history kept.
 *
 * A device that has just arrived has `alpha = 1` and adopts its answer whole.
 * That matters as much as the decay: a newcomer with a slow step would crawl to
 * its place from wherever it started.
 *
 * **What the floor is for.** Past `1 / alphaMin` windows this stops being a true
 * mean and becomes an exponential average over that many — and that is not a
 * concession, it is the only reason a device whose owner walks away is ever
 * followed. A true mean would hold it where the crowd first found it, forever,
 * and nothing else in the solve would notice: the graph is perfectly content
 * with the new distances. At the default the estimate is a mean over five
 * windows and catches up with a walk inside a second and a half.
 *
 * An earlier version of this watched each device for sustained disagreement and
 * threw its history away when it looked like it had moved. It is not here
 * because it was not needed — the floor already tracks — and because it did not
 * work: with the estimate still converging, every device disagrees with itself
 * for the first few windows, and the guard fired on ninety-nine devices out of a
 * hundred and twenty standing perfectly still.
 *
 * **This is a filter, not an estimator with a covariance.** It has no model of
 * velocity and cannot predict. The proper answer is a Kalman filter, and this is
 * not one.
 */
export class Relaxation {
  private evidence = new Int32Array(INITIAL_CAPACITY)

  constructor(private readonly options: RelaxationOptions) {}

  /** Fraction of the way to the new answer that slot `slot` moves. */
  stepFor(slot: number) {
    const seen = this.evidence[slot] ?? 0

    // The first answer is adopted whole — a device with one window of evidence
    // is the mean of one thing.
    if (seen <= 1) return 1

    return Math.max(this.options.alphaMin, 1 / seen)
  }

  /** One more window that had something to say about this device. */
  noteMeasurement(slot: number) {
    this.reserve(slot)
    this.evidence[slot] = (this.evidence[slot] ?? 0) + 1
  }

  /** A freed slot's history belongs to its previous tenant. */
  forget(slot: number) {
    this.reserve(slot)
    this.evidence[slot] = 0
  }

  evidenceAt(slot: number) {
    return this.evidence[slot] ?? 0
  }

  private reserve(slot: number) {
    if (slot < this.evidence.length) return

    const capacity = Math.max(slot + 1, this.evidence.length * 2)
    const evidence = new Int32Array(capacity)

    evidence.set(this.evidence)
    this.evidence = evidence
  }
}
