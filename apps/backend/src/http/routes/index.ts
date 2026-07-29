import type { FastifyInstance } from 'fastify';
import { adminEvent } from '../ws/admin-event.js';
import { joinEvent } from '../ws/join-event.js';
import { authenticateWithGithub } from './auth/authenticate-with-github.js';
import { getProfile } from './auth/get-profile.js';
import { createEvent } from './events/create-event.js';
import { getEvent } from './events/get-event.js';
import { getEventByLocation } from './events/get-event-by-location.js';
import { getEventGraph } from './events/get-event-graph.js';
import { getParticipants } from './events/get-participants.js';
import { listMyEvents } from './events/list-my-events.js';
import { healthRoute } from './health.js';

export async function routes(app: FastifyInstance) {
  // Meta
  await app.register(healthRoute);

  // Auth
  await app.register(authenticateWithGithub);
  await app.register(getProfile);

  // Events (REST)
  await app.register(createEvent);
  await app.register(listMyEvents);
  await app.register(getEventByLocation);
  await app.register(getEvent);
  await app.register(getParticipants);
  await app.register(getEventGraph);

  // Events (WebSocket)
  await app.register(joinEvent);
  await app.register(adminEvent);
}
