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
        tags: ['Event'],
        summary: '[WS] Admin Event',
        description:
          'WebSocket route used to administer an event. The first message must be ' +
          '`{"type": "AUTHENTICATION", "token": "<jwt>"}`.',
        params: z.object({
          eventId: z.string().uuid(),
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
