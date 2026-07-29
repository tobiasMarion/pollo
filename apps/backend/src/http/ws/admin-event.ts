import type { WebSocket } from '@fastify/websocket';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { EventService } from '../../events/event-service.js';
import { messageSchema, safeParseJsonMessage } from '../../schemas/messages.js';
import { sendMessage, startHeartbeat, WS_CLOSE } from './protocol.js';

interface AdminSocketDeps {
  verifyToken: (token: string) => { sub: string };
  findOpenEvent: (eventId: string, userId: string) => Promise<boolean>;
  getEvent: (eventId: string) => EventService | undefined;
}

export function handleAdminSocket(
  socket: WebSocket,
  eventId: string,
  { verifyToken, findOpenEvent, getEvent }: AdminSocketDeps,
) {
  let event: EventService | null = null;

  startHeartbeat(socket);

  socket.on('message', async (rawMessage) => {
    const { success, data } = safeParseJsonMessage(rawMessage.toString(), messageSchema);

    if (!success) {
      socket.close(WS_CLOSE.INVALID_MESSAGE, 'Invalid message');
      return;
    }

    if (event === null && data.type !== 'AUTHENTICATION') {
      socket.close(WS_CLOSE.UNAUTHORIZED, 'Authenticate first');
      return;
    }

    switch (data.type) {
      case 'AUTHENTICATION': {
        let userId: string;

        try {
          userId = verifyToken(data.token).sub;
        } catch {
          socket.close(WS_CLOSE.UNAUTHORIZED, 'Invalid auth token');
          return;
        }

        const isEventAdmin = await findOpenEvent(eventId, userId);
        const service = getEvent(eventId);

        if (!isEventAdmin || !service) {
          socket.close(WS_CLOSE.UNAUTHORIZED, 'Not the admin of an open event');
          return;
        }

        event = service;
        event.setAdminConnection((message) => sendMessage(socket, message));
        sendMessage(socket, { type: 'AUTHENTICATION_ACK' });
        break;
      }

      case 'EFFECT':
        event?.publish(data);
        break;

      default:
        // No other message types are expected from the admin.
        break;
    }
  });

  socket.on('close', () => {
    event?.clearAdminConnection();
  });
}

export async function adminEvent(app: FastifyInstance) {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/events/:eventId/admin',
    {
      websocket: true,
      schema: {
        operationId: 'adminEvent',
        tags: ['Event'],
        summary: '[WS] Administer an event',
        description: [
          'Upgrade-only. The owner watches the event here and drives it.',
          '',
          'Authentication is **in band** — a header is not an option on upgrade — so',
          'the first frame must be `{"type":"AUTHENTICATION","token":"<jwt>"}`. The',
          'server answers `AUTHENTICATION_ACK`; wait for it before trusting reports.',
          'Only one admin connection is wired at a time: a second one replaces the',
          'first, which stays open but goes quiet.',
          '',
          '### Frames you send',
          '',
          '| type | payload | meaning |',
          '| --- | --- | --- |',
          '| `AUTHENTICATION` | `token` | required first frame. |',
          '| `EFFECT` | `effect` | broadcast to every device and back to this socket. |',
          '',
          'Effects are discriminated by `name` — `PULSE`, `WAVE`, `ROTATE`, `SPIRAL` —',
          'and are relayed untouched: brightness never reaches the simulation.',
          '',
          '```json',
          '{ "type": "EFFECT", "effect": {',
          '  "name": "WAVE", "direction": "X",',
          '  "activeTime": 1.5, "spreadDelayPerUnit": 0.02 } }',
          '```',
          '',
          '### Frames you receive',
          '',
          'The admin sees everything, as `*_REPORT` variants carrying the `deviceId`',
          'that device-facing frames leave out.',
          '',
          '| type | when |',
          '| --- | --- |',
          '| `AUTHENTICATION_ACK` | authentication succeeded. |',
          '| `USER_JOINED` / `USER_LEFT` | a device joined or left. |',
          '| `LOCATION_UPDATE_REPORT` | a device moved. |',
          '| `DISTANCE_REPORT` | a distance was measured (`null` = edge dropped). |',
          '| `SET_POINT_REPORT` | the worker positioned a device. |',
          '| `EFFECT` | echo of effects fired here. |',
          '',
          '### Close codes',
          '',
          '| code | reason |',
          '| --- | --- |',
          '| `4400` | `Invalid message` — bad JSON or unknown `type`. |',
          '| `4401` | `Authenticate first` |',
          '| `4401` | `Invalid auth token` |',
          '| `4401` | `Not the admin of an open event` — wrong user, or not open. |',
          '',
          'Unknown ids are not rejected at connect time; the socket opens and fails',
          'authentication with `4401`. Disconnecting drops only the admin connection —',
          'the event keeps running.',
        ].join('\n'),
        params: z.object({
          eventId: z.string().uuid().describe('Id of an open event you administer.'),
        }),
      },
    },
    (socket, request) => {
      handleAdminSocket(socket, request.params.eventId, {
        verifyToken: (token) => app.jwt.verify<{ sub: string }>(token),
        findOpenEvent: async (eventId, userId) => {
          const event = await app.prisma.event.findUnique({
            where: { id: eventId, userId, status: 'OPEN' },
          });
          return event !== null;
        },
        getEvent: (eventId) => app.events.get(eventId),
      });
    },
  );
}
