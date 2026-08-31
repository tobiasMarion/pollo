const INITIAL_CAPACITY = 256

/**
 * What each pixel was last told, so a tick can send only what changed.
 *
 * A crowd standing still solves to the same coordinates every tick, and sending
 * them thirty times a second would be thirty times the traffic for no new
 * information. The threshold is in meters because that is what the difference
 * means: below it, nothing anybody could see on a screen has moved.
 *
 * One flat array indexed by slot, alongside the graph's. A map keyed by device
 * id would undo the reason slots exist.
 */
export class PublishLedger {
  private sent = new Float64Array(INITIAL_CAPACITY * 3)
  private everSent = new Uint8Array(INITIAL_CAPACITY)

  constructor(private readonly epsilon: number) {}

  /** Whether this position is worth a delta, given what the far end already has. */
  changed(slot: number, x: number, y: number, z: number) {
    this.reserve(slot)

    if (this.everSent[slot] === 0) return true

    const dx = x - (this.sent[slot * 3] ?? 0)
    const dy = y - (this.sent[slot * 3 + 1] ?? 0)
    const dz = z - (this.sent[slot * 3 + 2] ?? 0)

    return dx * dx + dy * dy + dz * dz >= this.epsilon * this.epsilon
  }

  record(slot: number, x: number, y: number, z: number) {
    this.reserve(slot)

    this.sent[slot * 3] = x
    this.sent[slot * 3 + 1] = y
    this.sent[slot * 3 + 2] = z
    this.everSent[slot] = 1
  }

  /**
   * A departed device's slot goes back in the pool, and the next arrival must
   * not inherit its history — otherwise the newcomer's first position looks
   * like a small move from wherever the previous tenant stood, and gets held
   * back by the threshold.
   */
  forget(slot: number) {
    this.reserve(slot)
    this.everSent[slot] = 0
  }

  private reserve(slot: number) {
    if (slot < this.everSent.length) return

    const capacity = Math.max(slot + 1, this.everSent.length * 2)

    const sent = new Float64Array(capacity * 3)
    sent.set(this.sent)
    this.sent = sent

    const everSent = new Uint8Array(capacity)
    everSent.set(this.everSent)
    this.everSent = everSent
  }
}
