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
        operationId: 'joinEvent',
        tags: ['Event'],
        summary: '[WS] Join an event as a pixel',
        description: [
          'Upgrade-only. A device joins here and is told how to paint itself. Frames',
          'are JSON discriminated by `type`; the **first** must be a `JOIN`, and later',
          'ones are ignored, so `deviceId` is fixed for the connection.',
          '',
          '### Frames you send',
          '',
          '| type | payload | meaning |',
          '| --- | --- | --- |',
          '| `JOIN` | `deviceId`, `location` | register as a pixel. Required first. |',
          '| `LOCATION_UPDATE` | `location` | the device moved. |',
          '| `DISTANCE` | `to`, `distance` | distance to another device, in meters. `null` drops the edge. |',
          '',
          '`DISTANCE` has no `from` — the sender is always the origin.',
          '',
          '```json',
          '{ "type": "JOIN", "deviceId": "device-1", "location": {',
          '  "latitude": -29.6842, "longitude": -53.8069,',
          '  "horizontalAccuracy": 5, "altitude": 100, "verticalAccuracy": 3 } }',
          '```',
          '',
          '### Frames you receive',
          '',
          '| type | when |',
          '| --- | --- |',
          '| `SET_POINT` | a new position **for this device**. Render `simulated`. |',
          '| `USER_JOINED` / `USER_LEFT` | any device joined or left. |',
          '| `EFFECT` | the admin fired an effect. |',
          '',
          '```json',
          '{ "type": "SET_POINT", "position": {',
          '  "uncorrected": { "relative": { "x": 0, "y": 0, "z": 0 },',
          '                   "absolute": { "x": 1, "y": 1, "z": 1 } },',
          '  "simulated":   { "relative": { "x": 0.5, "y": 0.5, "z": 0 },',
          '                   "absolute": { "x": 1.5, "y": 1.5, "z": 1 } } } }',
          '```',
          '',
          '### Close codes',
          '',
          '| code | reason |',
          '| --- | --- |',
          '| `4400` | `Invalid message` — bad JSON or unknown `type`. |',
          '| `4400` | `You must send a JOIN message first` |',
          '| `4404` | `Event not found` |',
          '',
          'Closing unsubscribes the device and broadcasts `USER_LEFT`. The server pings',
          'every 30 s and terminates connections that stop answering.',
        ].join('\n'),
        params: z.object({
          eventId: z.string().uuid().describe('Id of an open event.'),
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
