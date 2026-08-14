import type { WebSocket } from '@fastify/websocket'
import type { Message } from '@pollo/contracts'

/**
 * How much a socket may have waiting before it is treated as gone.
 *
 * A connection that stops draining does not make `send` fail or block — the
 * frames accumulate in the process, with no ceiling. One slow phone on a bad
 * connection is then indistinguishable from a leak.
 */
const MAX_BUFFERED_BYTES = 1024 * 1024

/**
 * Writes one frame, and says whether it went. `serialised` lets a fan-out pay
 * for `JSON.stringify` once instead of once per recipient.
 *
 * Dropping is safe for what this socket carries: positions are last-write-wins
 * and neighbour lists are resent on a timer, so a device that misses one gets
 * the next. A device that misses them all is one that stopped reading.
 */
export function sendMessage(socket: WebSocket, message: Message, serialised?: string) {
  if (socket.bufferedAmount > MAX_BUFFERED_BYTES) return false

  socket.send(serialised ?? JSON.stringify(message))

  return true
}
