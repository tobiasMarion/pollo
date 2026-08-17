import { describe, expect, it } from 'vitest'
import { PublishLedger } from './ledger.js'

describe('PublishLedger', () => {
  it('sends a pixel nobody has been told about', () => {
    const ledger = new PublishLedger(0.05)

    expect(ledger.changed(0, 1, 2, 3)).toBe(true)
  })

  it('holds back a move too small to see', () => {
    const ledger = new PublishLedger(0.05)

    ledger.record(0, 1, 2, 3)

    expect(ledger.changed(0, 1.01, 2, 3)).toBe(false)
  })

  it('sends a move at the threshold', () => {
    const ledger = new PublishLedger(0.05)

    ledger.record(0, 1, 2, 3)

    expect(ledger.changed(0, 1.05, 2, 3)).toBe(true)
  })

  /** The threshold is a distance, not a per-axis budget. */
  it('adds the axes up rather than judging them apart', () => {
    const ledger = new PublishLedger(0.05)

    ledger.record(0, 0, 0, 0)

    // 0.03 on each of three axes is 0.052 of movement, and no axis alone passes.
    expect(ledger.changed(0, 0.03, 0.03, 0.03)).toBe(true)
  })

  it('forgets a slot, so its next tenant is sent in full', () => {
    const ledger = new PublishLedger(0.05)

    ledger.record(0, 1, 2, 3)
    ledger.forget(0)

    expect(ledger.changed(0, 1, 2, 3)).toBe(true)
  })

  it('keeps slots apart as it grows past its initial size', () => {
    const ledger = new PublishLedger(0.05)

    ledger.record(5_000, 1, 2, 3)

    expect(ledger.changed(5_000, 1, 2, 3)).toBe(false)
    expect(ledger.changed(4_999, 1, 2, 3)).toBe(true)
  })
})
