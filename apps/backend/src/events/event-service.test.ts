import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import RedisMock from 'ioredis-mock';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Location } from '../schemas/location.js';
import type { Message } from '../schemas/messages.js';
import type { ControlMessage, IngestMessage } from '../schemas/wire.js';
import type { Bus } from './bus.js';
import { EventService } from './event-service.js';
import { GraphStore } from './graph-store.js';

const location: Location = {
  latitude: -29.7,
  longitude: -53.7,
  horizontalAccuracy: 5,
  altitude: 100,
  verticalAccuracy: 3,
};

const position = {
  uncorrected: { relative: { x: 0, y: 0, z: 0 }, absolute: { x: 1, y: 1, z: 1 } },
  simulated: { relative: { x: 0, y: 0, z: 0 }, absolute: { x: 1, y: 1, z: 1 } },
};

class FakeBus implements Bus {
  ingest: Array<{ eventId: string; message: IngestMessage }> = [];
  control: ControlMessage[] = [];

  publishIngest(eventId: string, message: IngestMessage) {
    this.ingest.push({ eventId, message });
  }

  publishControl(message: ControlMessage) {
    this.control.push(message);
  }

  subscribePositions() {
    return { stop: vi.fn() };
  }
}

describe('EventService', () => {
  let bus: FakeBus;
  let service: EventService;
  let adminInbox: Message[];

  beforeEach(() => {
    bus = new FakeBus();
    adminInbox = [];
    // ioredis-mock instances share one keyspace; a unique graph id isolates tests.
    const eventId = randomUUID();
    service = new EventService({
      id: eventId,
      location: { latitude: -29.7, longitude: -53.7 },
      adminId: 'admin-1',
      graphStore: new GraphStore(new RedisMock() as unknown as Redis, eventId),
      bus,
    });
    service.setAdminConnection((message) => adminInbox.push(message));
  });

  it('subscribe fans out USER_JOINED and publishes a JOIN ingest', async () => {
    const firstInbox: Message[] = [];
    service.subscribe({ deviceId: 'd1', location, sendMessage: (m) => firstInbox.push(m) });

    const secondInbox: Message[] = [];
    service.subscribe({ deviceId: 'd2', location, sendMessage: (m) => secondInbox.push(m) });

    await service.settled();

    expect(adminInbox.filter((m) => m.type === 'USER_JOINED')).toHaveLength(2);
    expect(firstInbox).toContainEqual({ type: 'USER_JOINED', deviceId: 'd2', location });
    expect(bus.ingest.map(({ message }) => message.op)).toEqual(['JOIN', 'JOIN']);

    expect(await service.getSubscribers()).toContainEqual({ deviceId: 'd1', location });
  });

  it('setDistanceToDevice reports to the admin and publishes DISTANCE', async () => {
    service.setDistanceToDevice('d1', 'd2', 4.2);
    service.setDistanceToDevice('d1', 'd2', null);

    await service.settled();

    expect(adminInbox).toEqual([
      { type: 'DISTANCE_REPORT', from: 'd1', to: 'd2', distance: 4.2 },
      { type: 'DISTANCE_REPORT', from: 'd1', to: 'd2', distance: null },
    ]);
    expect(bus.ingest.map(({ message }) => message)).toEqual([
      { op: 'DISTANCE', from: 'd1', to: 'd2', distance: 4.2 },
      { op: 'DISTANCE', from: 'd1', to: 'd2', distance: null },
    ]);

    expect((await service.getEventGraph()).edges).toEqual([]);
  });

  it('ignores location updates from unknown devices', () => {
    service.updateSubscriberLocation('ghost', location);

    expect(adminInbox).toEqual([]);
    expect(bus.ingest).toEqual([]);
  });

  it('unsubscribe publishes USER_LEFT and LEAVE, and forgets the device', async () => {
    const inbox: Message[] = [];
    service.subscribe({ deviceId: 'd1', location, sendMessage: (m) => inbox.push(m) });

    service.unsubscribe('d1');
    service.unsubscribe('d1');

    await service.settled();

    expect(adminInbox.filter((m) => m.type === 'USER_LEFT')).toHaveLength(1);
    expect(bus.ingest.map(({ message }) => message.op)).toEqual(['JOIN', 'LEAVE']);
    expect(await service.getSubscribers()).toEqual([]);
  });

  it('broadcastPositions routes SET_POINT to the right device and reports to the admin', () => {
    const first: Message[] = [];
    const second: Message[] = [];
    service.subscribe({ deviceId: 'd1', location, sendMessage: (m) => first.push(m) });
    service.subscribe({ deviceId: 'd2', location, sendMessage: (m) => second.push(m) });

    service.broadcastPositions({ kind: 'delta', points: [{ deviceId: 'd1', position }] });

    expect(first).toContainEqual({ type: 'SET_POINT', position });
    expect(second.filter((m) => m.type === 'SET_POINT')).toEqual([]);
    expect(adminInbox).toContainEqual({ type: 'SET_POINT_REPORT', deviceId: 'd1', position });
  });

  it('clearAdminConnection stops admin notifications', () => {
    service.clearAdminConnection();
    service.setDistanceToDevice('d1', 'd2', 1);

    expect(adminInbox).toEqual([]);
  });
});
