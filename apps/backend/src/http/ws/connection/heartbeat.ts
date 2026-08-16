import type { WebSocket } from '@fastify/websocket'

/** How long a socket may go without proving it is there. */
const SWEEP_INTERVAL_MS = 30_000

/**
 * How many sweeps a silent socket survives. One was too few: a missing pong
 * means the loop is behind, which is the worst moment to drop live connections.
 */
const SILENT_SWEEPS_ALLOWED = 2

interface Watched {
  socket: WebSocket
  /** Sweeps since this socket last gave any sign of life. */
  silent: number
}

/**
 * Keepalive for every socket in the process, on one timer rather than one per
 * connection — the old cost grew with exactly the number this is meant to raise.
 *
 * Traffic counts as a heartbeat, so a busy event pings almost nobody.
 */
export class Heartbeat {
  private readonly watched = new Set<Watched>()
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(private readonly intervalMs = SWEEP_INTERVAL_MS) {}

  watch(socket: WebSocket) {
    const entry: Watched = { socket, silent: 0 }

    this.watched.add(entry)

    // Closed over rather than looked up: this runs on every frame that arrives.
    const heard = () => {
      entry.silent = 0
    }

    socket.on('pong', heard)
    socket.on('message', heard)

    socket.on('close', () => {
      this.watched.delete(entry)

      if (this.watched.size === 0) this.stop()
    })

    this.start()
  }

  get size() {
    return this.watched.size
  }

  /** Only runs while there is something to watch. */
  private start() {
    if (this.timer) return

    this.timer = setInterval(() => this.sweep(), this.intervalMs)
    this.timer.unref?.()
  }

  stop() {
    if (!this.timer) return

    clearInterval(this.timer)
    this.timer = null
  }

  sweep() {
    for (const entry of this.watched) {
      if (entry.silent >= SILENT_SWEEPS_ALLOWED) {
        this.watched.delete(entry)
        entry.socket.terminate()
        continue
      }

      entry.silent++
      entry.socket.ping()
    }
  }
}
