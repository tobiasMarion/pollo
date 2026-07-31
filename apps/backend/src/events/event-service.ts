import type { FastifyBaseLogger } from 'fastify';
import type { ExactLocation, Location, PositionsMessage } from '@pollo/contracts';
import type { Admin, Message, SendMessage, Subscriber } from '../schemas/messages.js';
import type { Bus } from './bus.js';
import type { GraphStore } from './graph-store.js';

export interface EventServiceOptions {
  id: string;
  location: ExactLocation;
  adminId: string;
  graphStore: GraphStore;
  bus: Bus;
  logger?: FastifyBaseLogger;
}

/**
 * Pure IO for a live event: holds the connections (admin + subscribers), fans
 * out messages, persists the graph (REST reads + worker hydration) and
 * publishes mutations to the ingest stream. ALL position math lives in the
 * worker — no simulation ever runs here, never on the event loop.
 */
export class EventService {
  private readonly id: string;
  private readonly location: ExactLocation;
  private readonly admin: Admin;
  private readonly subscribers = new Map<string, SendMessage>();
  private readonly graphStore: GraphStore;
  private readonly bus: Bus;
  private readonly logger: FastifyBaseLogger | undefined;

  private pendingStoreWrites: Promise<unknown> = Promise.resolve();

  constructor({ id, location, adminId, graphStore, bus, logger }: EventServiceOptions) {
    this.id = id;
    this.location = location;
    this.graphStore = graphStore;
    this.bus = bus;
    this.logger = logger;
    this.admin = { userId: adminId, sendMessage: undefined };
  }

  /**
   * Store writes stay off the hot path (never awaited by callers), but they
   * must apply in dispatch order — otherwise a removeEdge can overtake the
   * setEdge that preceded it and resurrect the edge.
   */
  private enqueueStoreWrite(write: () => Promise<unknown>) {
    this.pendingStoreWrites = this.pendingStoreWrites
      .then(write)
      .catch((error) => this.logger?.error({ err: error }, 'graph store write failed'));
  }

  /** Resolves once every store write dispatched so far has been applied. */
  async settled() {
    await this.pendingStoreWrites;
  }

  getAdminId() {
    return this.admin.userId;
  }

  getLocation() {
    return this.location;
  }

  setAdminConnection(send: SendMessage) {
    this.admin.sendMessage = send;
  }

  clearAdminConnection() {
    this.admin.sendMessage = undefined;
  }

  async getSubscribers() {
    const metadata = await this.graphStore.listNodesMetadata();

    return Object.entries(metadata).map(([deviceId, data]) => ({
      deviceId,
      location: data.location,
    }));
  }

  async getEventGraph() {
    return await this.graphStore.getEventGraph();
  }

  notifyAdmin(message: Message) {
    this.admin.sendMessage?.(message);
  }

  publish(message: Message) {
    this.notifyAdmin(message);

    for (const sendMessage of this.subscribers.values()) {
      sendMessage(message);
    }
  }

  subscribe({ deviceId, location, sendMessage }: Subscriber) {
    this.publish({ type: 'USER_JOINED', deviceId, location });

    this.subscribers.set(deviceId, sendMessage);

    // The store copy exists for REST reads and worker hydration; the stream
    // publish is what actually drives the simulation.
    this.enqueueStoreWrite(() => this.graphStore.addNode(deviceId));
    this.enqueueStoreWrite(() => this.graphStore.setNodeLocation(deviceId, location));
    this.bus.publishIngest(this.id, { op: 'JOIN', deviceId, location });
  }

  setDistanceToDevice(from: string, to: string, distance: number | null) {
    if (distance === null) {
      this.enqueueStoreWrite(() => this.graphStore.removeEdge(from, to));
    } else {
      this.enqueueStoreWrite(() => this.graphStore.setEdge({ from, to, value: distance }));
    }

    this.notifyAdmin({ type: 'DISTANCE_REPORT', from, to, distance });

    this.bus.publishIngest(this.id, { op: 'DISTANCE', from, to, distance });
  }

  updateSubscriberLocation(deviceId: string, location: Location) {
    if (!this.subscribers.has(deviceId)) return;

    this.notifyAdmin({ type: 'LOCATION_UPDATE_REPORT', deviceId, location });
    this.enqueueStoreWrite(() => this.graphStore.setNodeLocation(deviceId, location));

    this.bus.publishIngest(this.id, { op: 'LOCATION_UPDATE', deviceId, location });
  }

  unsubscribe(deviceId: string) {
    if (!this.subscribers.has(deviceId)) return;

    this.subscribers.delete(deviceId);
    this.enqueueStoreWrite(() => this.graphStore.removeNode(deviceId));

    this.publish({ type: 'USER_LEFT', deviceId });

    this.bus.publishIngest(this.id, { op: 'LEAVE', deviceId });
  }

  /**
   * Fans out worker-computed positions (called by the positions subscription).
   * Only position travels — brightness is client-side.
   */
  broadcastPositions(message: PositionsMessage) {
    for (const { deviceId, position } of message.points) {
      this.subscribers.get(deviceId)?.({ type: 'SET_POINT', position });

      this.notifyAdmin({ type: 'SET_POINT_REPORT', deviceId, position });
    }
  }
}
