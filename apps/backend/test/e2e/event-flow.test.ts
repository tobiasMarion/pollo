import type { AddressInfo } from 'node:net';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { type Message, messageSchema } from '../../src/schemas/messages.js';
import { STREAM_FIELD, streamKeys } from '@pollo/contracts';
import { createTestApp, createUser, truncateDatabase, waitFor } from '../helpers.js';
import { TEST_REDIS_URL } from '../test-env.js';

type TestApp = Awaited<ReturnType<typeof createTestApp>>;

const location = {
  latitude: -29.6842,
  longitude: -53.8069,
  horizontalAccuracy: 5,
  altitude: 100,
  verticalAccuracy: 3,
};

const position = {
  uncorrected: { relative: { x: 0, y: 0, z: 0 }, absolute: { x: 1, y: 1, z: 1 } },
  simulated: { relative: { x: 0.5, y: 0.5, z: 0 }, absolute: { x: 1.5, y: 1.5, z: 1 } },
};

/** Buffers incoming messages so tests can await specific types in order. */
class WsClient {
  private readonly socket: WebSocket;
  private readonly inbox: Message[] = [];
  private readonly openPromise: Promise<void>;

  constructor(url: string) {
    this.socket = new WebSocket(url);
    this.openPromise = new Promise((resolve, reject) => {
      this.socket.once('open', resolve);
      this.socket.once('error', reject);
    });
    this.socket.on('message', (raw) => {
      const parsed = messageSchema.safeParse(JSON.parse(raw.toString()));
      if (parsed.success) this.inbox.push(parsed.data);
    });
  }

  async ready() {
    await this.openPromise;
    return this;
  }

  send(message: unknown) {
    this.socket.send(JSON.stringify(message));
  }

  async next<T extends Message['type']>(type: T) {
    return (await waitFor(
      () => this.inbox.find((message) => message.type === type),
      (found) => found !== undefined,
    )) as Extract<Message, { type: T }>;
  }

  received(type: Message['type']) {
    return this.inbox.filter((message) => message.type === type);
  }

  close() {
    this.socket.close();
  }

  get closed() {
    return new Promise<void>((resolve) => {
      if (this.socket.readyState === WebSocket.CLOSED) return resolve();
      this.socket.once('close', () => resolve());
    });
  }
}

describe('event lifecycle end to end', () => {
  let app: TestApp;
  let redis: Redis;
  let baseUrl: string;
  let wsUrl: string;
  let token: string;

  beforeAll(async () => {
    app = await createTestApp();
    await truncateDatabase(app);

    redis = new Redis(TEST_REDIS_URL);
    await redis.flushdb();

    await app.listen({ host: '127.0.0.1', port: 0 });
    const { port } = app.server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
    wsUrl = `ws://127.0.0.1:${port}`;

    ({ token } = await createUser(app, 'e2e-admin@test.dev'));
  });

  afterAll(async () => {
    await truncateDatabase(app);
    await redis.quit();
    await app.close();
  });

  it('runs the full flow: create, admin auth, join, distances, worker positions', async () => {
    const createResponse = await fetch(`${baseUrl}/events`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ name: 'E2E Night', ...location, type: 'SCREEN' }),
    });
    expect(createResponse.status).toBe(201);
    const { eventId } = (await createResponse.json()) as { eventId: string };

    const controlEntries = await redis.xrange(streamKeys.control(), '-', '+');
    const controlOps = controlEntries.map(([, fields]) => {
      const data = fields[fields.indexOf(STREAM_FIELD) + 1];
      return JSON.parse(data ?? '{}').op;
    });
    expect(controlOps).toContain('EVENT_OPENED');

    const admin = await new WsClient(`${wsUrl}/events/${eventId}/admin`).ready();
    admin.send({ type: 'AUTHENTICATION', token });
    await admin.next('AUTHENTICATION_ACK');

    const subscriber = await new WsClient(`${wsUrl}/events/${eventId}/join`).ready();
    subscriber.send({ type: 'JOIN', deviceId: 'device-1', location });

    const joined = await admin.next('USER_JOINED');
    expect(joined.deviceId).toBe('device-1');

    subscriber.send({ type: 'DISTANCE', to: 'device-2', distance: 3.2 });

    const distanceReport = await admin.next('DISTANCE_REPORT');
    expect(distanceReport).toMatchObject({ from: 'device-1', to: 'device-2', distance: 3.2 });

    const ingestEntries = await waitFor(
      () => redis.xrange(streamKeys.ingest(eventId), '-', '+'),
      (entries) => entries.length >= 2,
    );
    const ingestOps = ingestEntries.map(([, fields]) => {
      const data = fields[fields.indexOf(STREAM_FIELD) + 1];
      return JSON.parse(data ?? '{}').op;
    });
    expect(ingestOps).toEqual(['JOIN', 'DISTANCE']);

    // Simulated Rust worker: writes a positions delta for the subscriber.
    await redis.xadd(
      streamKeys.positions(eventId),
      '*',
      STREAM_FIELD,
      JSON.stringify({ kind: 'delta', points: [{ deviceId: 'device-1', position }] }),
    );

    const setPoint = await subscriber.next('SET_POINT');
    expect(setPoint.position).toEqual(position);

    const setPointReport = await admin.next('SET_POINT_REPORT');
    expect(setPointReport).toMatchObject({ deviceId: 'device-1', position });

    const participantsResponse = await fetch(`${baseUrl}/events/${eventId}/participants`);
    const { participants } = (await participantsResponse.json()) as {
      participants: Array<{ deviceId: string }>;
    };
    expect(participants.map((p) => p.deviceId)).toEqual(['device-1']);

    subscriber.close();
    await subscriber.closed;

    const left = await admin.next('USER_LEFT');
    expect(left.deviceId).toBe('device-1');

    admin.close();
    await admin.closed;
  });

  it('rejects a join to an unknown event with the NOT_FOUND close code', async () => {
    const socket = new WebSocket(`${wsUrl}/events/00000000-0000-4000-8000-000000000000/join`);

    const code = await new Promise<number>((resolve) => {
      socket.on('close', (closeCode) => resolve(closeCode));
    });

    expect(code).toBe(4404);
  });

  it('closes the admin socket of a non-admin with the UNAUTHORIZED close code', async () => {
    const createResponse = await fetch(`${baseUrl}/events`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ name: 'E2E Night 2', ...location, type: 'SCREEN' }),
    });
    const { eventId } = (await createResponse.json()) as { eventId: string };

    const { token: strangerToken } = await createUser(app, 'e2e-stranger@test.dev');

    const socket = new WebSocket(`${wsUrl}/events/${eventId}/admin`);
    socket.on('open', () => {
      socket.send(JSON.stringify({ type: 'AUTHENTICATION', token: strangerToken }));
    });

    const code = await new Promise<number>((resolve) => {
      socket.on('close', (closeCode) => resolve(closeCode));
    });

    expect(code).toBe(4401);
  });
});
