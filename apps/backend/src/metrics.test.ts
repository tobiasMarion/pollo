import { afterEach, describe, expect, it } from 'vitest'
import { isQuiet, Metrics } from './metrics.js'

const START = 1_000_000

describe('Metrics', () => {
  let metrics: Metrics

  afterEach(() => metrics?.stop())

  it('reports totals and the same totals per second', () => {
    metrics = new Metrics(START)

    metrics.count('framesIn', 300)
    metrics.count('framesIn')

    const snapshot = metrics.take(START + 2_000)

    expect(snapshot.window).toBe(2_000)
    expect(snapshot.counters.framesIn).toBe(301)
    expect(snapshot.rates.framesIn).toBe(151)
  })

  it('starts a new window on every cut', () => {
    metrics = new Metrics(START)

    metrics.count('framesIn', 10)
    metrics.take(START + 1_000)

    const second = metrics.take(START + 2_000)

    expect(second.counters.framesIn).toBeUndefined()
  })

  it('summarises how many, how much and how bad', () => {
    metrics = new Metrics(START)

    metrics.observe('storeFlush', 4)
    metrics.observe('storeFlush', 10)
    metrics.observe('storeFlush', 1)

    expect(metrics.take(START + 1_000).summaries.storeFlush).toEqual({
      count: 3,
      total: 15,
      max: 10,
      mean: 5,
    })
  })

  it('reads gauges at the cut, and keeps them across windows', () => {
    metrics = new Metrics(START)

    let connections = 0
    metrics.gauge('connections', () => connections)

    connections = 42
    expect(metrics.take(START + 1_000).gauges.connections).toBe(42)

    connections = 7
    expect(metrics.take(START + 2_000).gauges.connections).toBe(7)
  })

  it('has nothing to show before the first window closes', () => {
    metrics = new Metrics(START)

    expect(metrics.latest()).toBeNull()

    const cut = metrics.take(START + 1_000)

    expect(metrics.latest()).toBe(cut)
  })

  it('calls a window quiet only when nothing happened anywhere', () => {
    metrics = new Metrics(START)

    let connections = 0
    metrics.gauge('connections', () => connections)

    expect(isQuiet(metrics.take(START + 1_000))).toBe(true)

    // Nobody sent anything, but somebody is connected — a window where the
    // crowd is silent and still there is worth a line.
    connections = 1
    expect(isQuiet(metrics.take(START + 2_000))).toBe(false)

    connections = 0
    metrics.count('framesIn')
    expect(isQuiet(metrics.take(START + 3_000))).toBe(false)
  })
})
