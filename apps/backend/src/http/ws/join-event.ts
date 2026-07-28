import type { WebSocket } from '@fastify/websocket';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { EventService } from '../../events/event-service.js';
import { messageSchema, safeParseJsonMessage } from '../../schemas/messages.js';
import { sendMessage, startHeartbeat, WS_CLOSE } from './protocol.js';

export function handleJoinSocket(socket: WebSocket, event: EventService, log: FastifyBaseLogger) {
  let deviceId: string | null = null;

  startHeartbeat(socket);

  socket.on('message', (rawMessage) => {
    const { success, data, error } = safeParseJsonMessage(rawMessage.toString(), messageSchema);

    if (!success) {
      log.debug({ error }, 'invalid join-socket message');
      socket.close(WS_CLOSE.INVALID_MESSAGE, 'Invalid message');
      return;
    }

    if (deviceId === null && data.type !== 'JOIN') {
      socket.close(WS_CLOSE.INVALID_MESSAGE, 'You must send a JOIN message first');
      return;
    }

    switch (data.type) {
      case 'JOIN':
        if (deviceId !== null) break; // ignore repeated JOINs

        deviceId = data.deviceId;
        event.subscribe({
          deviceId,
          location: data.location,
          sendMessage: (message) => sendMessage(socket, message),
        });
        break;

      case 'LOCATION_UPDATE':
        if (deviceId !== null) {
          event.updateSubscriberLocation(deviceId, data.location);
        }
        break;

      case 'DISTANCE':
        if (deviceId !== null) {
          event.setDistanceToDevice(deviceId, data.to, data.distance);
        }
        break;

      default:
        // Server-emitted reports and admin-only messages are not accepted here.
        log.debug({ type: data.type }, 'unexpected message on join socket');
        break;
    }
  });

  socket.on('close', () => {
    if (deviceId !== null) {
      event.unsubscribe(deviceId);
    }
  });
}

export async function joinEvent(app: FastifyInstance) {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/events/:eventId/join',
    {
      websocket: true,
      schema: {
        tags: ['Event'],
        summary: '[WS] Join Event',
        description:
          'WebSocket route used to join an event and receive instructions on how to ' +
          'paint this pixel. The first message must be a JOIN, which registers the ' +
          'device as a pixel of the event.',
        params: z.object({
          eventId: z.string().uuid(),
        }),
      },
    },
    (socket, request) => {
      const event = app.events.get(request.params.eventId);

      if (!event) {
        socket.close(WS_CLOSE.NOT_FOUND, 'Event not found');
        return;
      }

      handleJoinSocket(socket, event, request.log);
    },
  );
}
