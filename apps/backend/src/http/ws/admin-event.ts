import type { WebSocket } from '@fastify/websocket'
import {
  adminInbound,
  adminOutbound,
  effectNames,
  messageTable,
  safeParseJsonMessage,
  WS_CLOSE,
} from '@pollo/contracts'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import type { LiveEvent } from '../../events/live-event.js'
import type { Heartbeat } from './connection/heartbeat.js'
import { sendMessage } from './connection/protocol.js'

interface AdminSocketDeps {
  verifyToken: (token: string) => { sub: string }
  findOpenEvent: (eventId: string, userId: string) => Promise<boolean>
  getEvent: (eventId: string) => LiveEvent | undefined
  heartbeat: Heartbeat
}

export function handleAdminSocket(
  socket: WebSocket,
  eventId: string,
  { verifyToken, findOpenEvent, getEvent, heartbeat }: AdminSocketDeps,
) {
  let event: LiveEvent | null = null

  heartbeat.watch(socket)

  socket.on('message', async rawMessage => {
    const { success, data } = safeParseJsonMessage(rawMessage.toString(), adminOutbound.schema)

    if (!success) {
      socket.close(WS_CLOSE.INVALID_MESSAGE, 'Invalid message')
      return
    }

    if (event === null && data.type !== 'AUTHENTICATION') {
      socket.close(WS_CLOSE.UNAUTHORIZED, 'Authenticate first')
      return
    }

    switch (data.type) {
      case 'AUTHENTICATION': {
        let userId: string

        try {
          userId = verifyToken(data.token).sub
        } catch {
          socket.close(WS_CLOSE.UNAUTHORIZED, 'Invalid auth token')
          return
        }

        const isEventAdmin = await findOpenEvent(eventId, userId)
        const service = getEvent(eventId)

        if (!isEventAdmin || !service) {
          socket.close(WS_CLOSE.UNAUTHORIZED, 'Not the admin of an open event')
          return
        }

        event = service
        event.setAdminConnection(message => sendMessage(socket, message))
        sendMessage(socket, { type: 'AUTHENTICATION_ACK' })
        break
      }

      case 'EFFECT':
        event?.publish(data)
        break
    }
  })

  socket.on('close', () => {
    event?.clearAdminConnection()
  })
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
          messageTable(adminOutbound),
          '',
          `Effects are discriminated by \`name\` — ${effectNames.map(name => `\`${name}\``).join(', ')} —`,
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
          'The field arrives in batches rather than a frame per device event. A crowd',
          'of twenty thousand phones reporting once a second is twenty thousand frames',
          'a second before distances are counted, and a panel draws a field rather than',
          'following an event log — so repeated news about one device collapses to its',
          'latest value and a batch costs at worst one entry per device, however busy',
          'the second was.',
          '',
          messageTable(adminInbound),
          '',
          'The arrays of a `FIELD_UPDATE` are consistent with each other: a device that',
          'joined and left inside the same window appears only in `left`, one that left',
          'and rejoined only in `locations`, and no edge names a device the same batch',
          'reports gone. Nothing in a batch has to be applied before anything else.',
          '',
          '`at` and `window` are what a client animates across — positions are a second',
          'behind by design, and interpolating between batches is what keeps a batched',
          'field moving smoothly.',
          '',
          '```json',
          '{ "type": "FIELD_UPDATE", "at": 1730000000000, "window": 1000,',
          '  "locations": [ { "deviceId": "device-1", "location": { "latitude": -29.6842,',
          '    "longitude": -53.8069, "horizontalAccuracy": 5, "altitude": 100,',
          '    "verticalAccuracy": 3 } } ],',
          '  "placed": [], "left": [],',
          '  "edges": [ { "from": "device-1", "to": "device-2", "distance": 3.2 } ] }',
          '```',
          '',
          '### Close codes',
          '',
          '| code | reason |',
          '| --- | --- |',
          '| `4400` | `Invalid message` — bad JSON, or a `type` this socket does not accept. |',
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
        verifyToken: token => app.jwt.verify<{ sub: string }>(token),
        findOpenEvent: (eventId, userId) => app.eventRepository.isOpenAdmin(eventId, userId),
        getEvent: eventId => app.events.get(eventId),
        heartbeat: app.heartbeat,
      })
    },
  )
}
