import type { WebSocket } from '@fastify/websocket';
import type { Message } from '../../schemas/messages.js';

/** Application close codes (4000-4999 range is reserved for applications). */
export const WS_CLOSE = {
  INVALID_MESSAGE: 4400,
  UNAUTHORIZED: 4401,
  NOT_FOUND: 4404,
} as const;

export function sendMessage(socket: WebSocket, message: Message) {
  socket.send(JSON.stringify(message));
}

const HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * Ping/pong keepalive: terminates connections that stop answering, so dead
 * subscribers do not linger in the fan-out maps.
 */
export function startHeartbeat(socket: WebSocket, intervalMs = HEARTBEAT_INTERVAL_MS) {
  let alive = true;

  socket.on('pong', () => {
    alive = true;
  });

  const timer = setInterval(() => {
    if (!alive) {
      socket.terminate();
      return;
    }

    alive = false;
    socket.ping();
  }, intervalMs);

  socket.on('close', () => clearInterval(timer));
}
