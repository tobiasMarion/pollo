import type { WebSocket } from '@fastify/websocket'
import type { Message } from '@pollo/contracts'

export function sendMessage(socket: WebSocket, message: Message) {
  socket.send(JSON.stringify(message))
}
