import { SimulationPool } from '../run/pool.js'
import { fetchEvent, joinSocketUrl } from './api.js'
import { parseConfig, usage } from './config.js'
import { dashboardReporter } from './dashboard.js'
import { jsonReporter, plainReporter, type Reporter } from './reporter.js'

/** How often the crowd is measured and drawn. */
const SAMPLE_INTERVAL_MS = 500

/**
 * How often the field view is redrawn between samples.
 *
 * A cue is over in a couple of seconds, so at the sampling rate a wave crossing
 * the venue would be four still frames. Nothing is re-measured here — the shards
 * write the crowd into shared memory continuously and this only reads it.
 */
const FRAME_INTERVAL_MS = 50

/** How long a tidy shutdown gets before the process leaves anyway. */
const SHUTDOWN_GRACE_MS = 5_000

/** How often to check that anybody is still upstream of this run. */
const ORPHAN_CHECK_MS = 2_000

async function main() {
  const parsed = parseConfig(process.argv.slice(2))

  if (parsed.help) {
    console.log(usage())
    return
  }

  const { config } = parsed
  const event = await fetchEvent(config.api, config.event, reason => console.error(reason))

  if (event.status !== 'OPEN') {
    throw new Error(`Event ${event.name} is ${event.status} — devices can only join OPEN events.`)
  }

  const pool = new SimulationPool(config, joinSocketUrl(config.api, config.event), {
    latitude: event.latitude,
    longitude: event.longitude,
  })

  const reporter: Reporter = config.json
    ? jsonReporter()
    : config['no-chart']
      ? plainReporter(config)
      : dashboardReporter(config, pool.field())
  const shards = Math.min(config.threads, config.clients)

  reporter.start({
    eventName: event.name,
    eventId: event.id,
    venue: config.venue,
    clients: config.clients,
    seed: config.seed,
    shards,
  })

  let stopping = false

  const finish = async (code = 0) => {
    if (stopping) return
    stopping = true

    clearInterval(sampler)
    clearInterval(frames)
    clearTimeout(deadline)
    releaseKeyboard()

    // Leaving is not optional. Every device holds a socket the API believes in,
    // and a run that lingers keeps reporting a crowd that is not there — which
    // looks like a bug in the panel rather than a process nobody killed.
    const abandon = setTimeout(() => process.exit(code), SHUTDOWN_GRACE_MS)

    await pool.stop()
    reporter.render(pool.sample())
    reporter.stop()

    clearTimeout(abandon)
    process.exit(code)
  }

  const sampler = setInterval(() => reporter.render(pool.sample()), SAMPLE_INTERVAL_MS)
  const frames = setInterval(() => reporter.redraw?.(), FRAME_INTERVAL_MS)

  const releaseKeyboard = readKeys({
    onKey: key => {
      if (key !== ' ') return reporter.key?.(key)

      pool.setNoise(!pool.noise)
      reporter.render(pool.sample())
    },
    onInterrupt: () => void finish(0),
  })

  const deadline = config.duration
    ? setTimeout(() => void finish(), config.duration * 1_000)
    : undefined

  pool.onShardError(error => {
    console.error(`shard failed: ${error.message}`)
    void finish()
  })

  /**
   * SIGHUP matters as much as the other two: `just simulate` runs the CLI under
   * `just` and npm, so closing the terminal can take the wrappers and leave
   * this process orphaned — still holding thousands of sockets and still
   * reporting a crowd nobody is watching.
   *
   * The second signal is not polite. Registering a handler removes Node's own
   * "exit on SIGINT", so a shutdown that stalls would otherwise make the run
   * unkillable by the key that everybody reaches for twice.
   */
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.on(signal, () => {
      if (stopping) process.exit(1)
      void finish(0)
    })
  }

  /**
   * Signals only cover the launcher being asked politely. `just simulate` puts
   * `just`, npm and tsx between the terminal and this process, and killing any
   * of them outright leaves the crowd here orphaned — sockets open, still
   * reporting, for as long as the machine is up. That reads as a panel drawing
   * devices that are gone, which is a hard thing to diagnose from the panel.
   *
   * Reparenting is the signal that nobody is upstream any more. Only checked
   * against the parent that actually launched the run, so a process that was
   * always detached is left alone.
   */
  const launcher = process.ppid

  if (launcher > 1) {
    setInterval(() => {
      if (process.ppid !== launcher) {
        console.error('the process that started this run is gone — disconnecting')
        void finish(1)
      }
    }, ORPHAN_CHECK_MS).unref()
  }
}

/**
 * Keys the operator can press while the run is live.
 *
 * Raw mode is what makes a single keypress arrive at all — a cooked terminal
 * holds the line until a newline — and it also takes Ctrl-C away from the
 * kernel, so the interrupt arrives here as a byte and has to be honoured by
 * hand. Anywhere without a terminal, this does nothing and the run behaves as
 * it always did.
 */
function readKeys(handlers: { onKey: (key: string) => void; onInterrupt: () => void }) {
  const input = process.stdin

  if (!input.isTTY) return () => {}

  input.setRawMode(true)
  input.resume()
  input.setEncoding('utf8')

  const onData = (chunk: string) => {
    for (const key of chunk) {
      if (key === '\u0003') handlers.onInterrupt()
      else handlers.onKey(key)
    }
  }

  input.on('data', onData)

  return () => {
    input.off('data', onData)
    input.setRawMode(false)
    input.pause()
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
