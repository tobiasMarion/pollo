import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, createUser, truncateDatabase, waitFor } from '../helpers.js';

type TestApp = Awaited<ReturnType<typeof createTestApp>>;

const payload = {
  name: 'Firefly Night',
  latitude: -29.6842,
  longitude: -53.8069,
  type: 'TORCH' as const,
};

describe('event REST routes', () => {
  let app: TestApp;
  let token: string;
  let userId: string;

  beforeAll(async () => {
    app = await createTestApp();
    await truncateDatabase(app);
    ({
      user: { id: userId },
      token,
    } = await createUser(app));
  });

  beforeEach(async () => {
    await app.prisma.event.deleteMany();
  });

  afterAll(async () => {
    await truncateDatabase(app);
    await app.close();
  });

  it('POST /events requires auth', async () => {
    const response = await app.inject({ method: 'POST', url: '/events', payload });
    expect(response.statusCode).toBe(401);
  });

  it('POST /events creates the event and registers it in the runtime', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/events',
      payload,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(201);
    const { eventId } = response.json<{ eventId: string }>();

    expect(app.events.get(eventId)).toBeDefined();
    expect(app.events.get(eventId)?.getAdminId()).toBe(userId);

    const persisted = await app.prisma.event.findUnique({ where: { id: eventId } });
    expect(persisted?.status).toBe('OPEN');
  });

  it('GET /events/:id returns the event and 404s on unknown ids', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/events',
      payload,
      headers: { authorization: `Bearer ${token}` },
    });
    const { eventId } = created.json<{ eventId: string }>();

    const found = await app.inject({ method: 'GET', url: `/events/${eventId}` });
    expect(found.statusCode).toBe(200);
    expect(found.json().event).toMatchObject({ id: eventId, name: payload.name, status: 'OPEN' });

    const missing = await app.inject({
      method: 'GET',
      url: '/events/00000000-0000-4000-8000-000000000000',
    });
    expect(missing.statusCode).toBe(404);
  });

  it('GET /events lists only the events of the caller, newest first', async () => {
    const first = await app.inject({
      method: 'POST',
      url: '/events',
      payload,
      headers: { authorization: `Bearer ${token}` },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/events',
      payload: { ...payload, name: 'Second Night' },
      headers: { authorization: `Bearer ${token}` },
    });

    const mine = await app.inject({
      method: 'GET',
      url: '/events',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(mine.statusCode).toBe(200);
    expect(mine.json<{ events: Array<{ id: string }> }>().events.map(({ id }) => id)).toEqual([
      second.json().eventId,
      first.json().eventId,
    ]);

    const { token: strangerToken } = await createUser(app, `stranger-list-${Date.now()}@test.dev`);
    const theirs = await app.inject({
      method: 'GET',
      url: '/events',
      headers: { authorization: `Bearer ${strangerToken}` },
    });
    expect(theirs.json().events).toEqual([]);

    const anonymous = await app.inject({ method: 'GET', url: '/events' });
    expect(anonymous.statusCode).toBe(401);
  });

  it('GET /events/around finds the closest open event within ~1km', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/events',
      payload,
      headers: { authorization: `Bearer ${token}` },
    });
    const { eventId } = created.json<{ eventId: string }>();

    const near = await app.inject({
      method: 'GET',
      url: `/events/around?latitude=${payload.latitude + 0.001}&longitude=${payload.longitude}`,
    });
    expect(near.statusCode).toBe(200);
    expect(near.json().event.id).toBe(eventId);

    const far = await app.inject({
      method: 'GET',
      url: '/events/around?latitude=40.0&longitude=-3.0',
    });
    expect(far.statusCode).toBe(404);
  });

  it('GET /events/:id/participants reflects live subscribers', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/events',
      payload,
      headers: { authorization: `Bearer ${token}` },
    });
    const { eventId } = created.json<{ eventId: string }>();
    const service = app.events.get(eventId);
    expect(service).toBeDefined();

    service?.subscribe({
      deviceId: 'device-1',
      location: {
        latitude: payload.latitude,
        longitude: payload.longitude,
        horizontalAccuracy: 5,
        altitude: 10,
        verticalAccuracy: 5,
      },
      sendMessage: () => {},
    });

    const participants = await waitFor(
      async () => {
        const response = await app.inject({
          method: 'GET',
          url: `/events/${eventId}/participants`,
        });
        return response.json<{ participants: Array<{ deviceId: string }> }>().participants;
      },
      (list) => list.length === 1,
    );

    expect(participants[0]?.deviceId).toBe('device-1');
  });

  it('GET /events/:id/graph is only visible to the event admin', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/events',
      payload,
      headers: { authorization: `Bearer ${token}` },
    });
    const { eventId } = created.json<{ eventId: string }>();

    const asAdmin = await app.inject({
      method: 'GET',
      url: `/events/${eventId}/graph`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(asAdmin.statusCode).toBe(200);
    expect(asAdmin.json()).toHaveProperty('nodes');
    expect(asAdmin.json()).toHaveProperty('edges');

    const { token: strangerToken } = await createUser(app, `stranger-${Date.now()}@test.dev`);
    const asStranger = await app.inject({
      method: 'GET',
      url: `/events/${eventId}/graph`,
      headers: { authorization: `Bearer ${strangerToken}` },
    });
    expect(asStranger.statusCode).toBe(404);
  });
});
