import { SvelteMap } from 'svelte/reactivity';
import { apiSocketUrl } from '$lib/api/client';
import type {
  AdminInboundMessage,
  AdminOutboundMessage,
  DeviceLocation,
  Effect,
  EventGraph,
  Position,
} from '$lib/api/types';

export interface DeviceState {
  deviceId: string;
  /** Null while the only thing seen about a device is a position report. */
  location: DeviceLocation | null;
  /** Absent until the worker has published a position for this device. */
  position: Position | null;
  /** Wall clock of the last frame about this device — drives the "recent" fade. */
  updatedAt: number;
}

export type ConnectionStatus =
  | 'connecting'
  | 'authenticating'
  | 'live'
  | 'reconnecting'
  | 'rejected'
  | 'closed';

/** Application close codes the API uses (see http/ws/protocol.ts). */
const WS_CLOSE = {
  INVALID_MESSAGE: 4400,
  UNAUTHORIZED: 4401,
  NOT_FOUND: 4404,
} as const;

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 15_000;

export function edgeKey(from: string, to: string): string {
  return `${from}>${to}`;
}

/**
 * Live state of one event, fed by the admin socket.
 *
 * Devices and edges are reactive maps: the panel watches an event, not the
 * whole swarm, so hundreds of entries stay well inside what fine-grained
 * reactivity handles. The canvas reads the same maps every frame.
 */
export class EventConsole {
  readonly devices = new SvelteMap<string, DeviceState>();
  readonly edges = new SvelteMap<string, { from: string; to: string; value: number }>();

  status = $state<ConnectionStatus>('connecting');
  /** Set when the socket is closed for good — a reconnect would not help. */
  error = $state<string | null>(null);
  /** The last effect fired, and when, so views can echo the wavefront. */
  lastEffect = $state<{ effect: Effect; firedAt: number } | null>(null);

  #eventId: string;
  #token: string;
  #socket: WebSocket | null = null;
  #retries = 0;
  #reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  #closedByUs = false;

  constructor(eventId: string, token: string) {
    this.#eventId = eventId;
    this.#token = token;
  }

  /** Seeds the maps from `GET /events/:id/graph` so the view starts populated. */
  hydrate(graph: EventGraph) {
    const now = Date.now();

    for (const [deviceId, metadata] of Object.entries(graph.nodes)) {
      this.devices.set(deviceId, {
        deviceId,
        location: metadata.location,
        position: metadata.position ?? null,
        updatedAt: now,
      });
    }

    for (const edge of graph.edges) {
      this.edges.set(edgeKey(edge.from, edge.to), edge);
    }
  }

  connect() {
    this.#closedByUs = false;

    const socket = new WebSocket(apiSocketUrl(`/events/${this.#eventId}/admin`));
    this.#socket = socket;
    this.status = this.#retries === 0 ? 'connecting' : 'reconnecting';

    socket.addEventListener('open', () => {
      this.status = 'authenticating';
      this.#send({ type: 'AUTHENTICATION', token: this.#token });
    });

    socket.addEventListener('message', (message) => {
      this.#receive(message.data);
    });

    socket.addEventListener('close', (event) => {
      this.#socket = null;

      if (this.#closedByUs) {
        this.status = 'closed';
        return;
      }

      // 4401 is the admin check failing and 4404 an event the runtime does not
      // hold: both are verdicts, not hiccups, so retrying only spins.
      if (event.code === WS_CLOSE.UNAUTHORIZED || event.code === WS_CLOSE.NOT_FOUND) {
        this.status = 'rejected';
        this.error = event.reason || 'The API refused this event.';
        return;
      }

      this.#scheduleReconnect();
    });
  }

  fireEffect(effect: Effect) {
    if (this.status !== 'live') return;

    this.#send({ type: 'EFFECT', effect });
  }

  destroy() {
    this.#closedByUs = true;

    if (this.#reconnectTimer) clearTimeout(this.#reconnectTimer);

    this.#socket?.close();
    this.#socket = null;
    this.status = 'closed';
  }

  #send(message: AdminOutboundMessage) {
    this.#socket?.send(JSON.stringify(message));
  }

  #scheduleReconnect() {
    this.status = 'reconnecting';

    const delay = Math.min(RECONNECT_BASE_MS * 2 ** this.#retries, RECONNECT_MAX_MS);
    this.#retries += 1;

    this.#reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  #receive(raw: unknown) {
    if (typeof raw !== 'string') return;

    let message: AdminInboundMessage;

    try {
      message = JSON.parse(raw) as AdminInboundMessage;
    } catch {
      return;
    }

    const now = Date.now();

    switch (message.type) {
      case 'AUTHENTICATION_ACK':
        // Only now are reports guaranteed to flow.
        this.status = 'live';
        this.error = null;
        this.#retries = 0;
        break;

      case 'USER_JOINED':
      case 'LOCATION_UPDATE_REPORT':
        this.#upsertDevice(message.deviceId, { location: message.location, updatedAt: now });
        break;

      case 'SET_POINT_REPORT':
        this.#upsertDevice(message.deviceId, { position: message.position, updatedAt: now });
        break;

      case 'USER_LEFT': {
        this.devices.delete(message.deviceId);

        for (const [key, edge] of this.edges) {
          if (edge.from === message.deviceId || edge.to === message.deviceId) {
            this.edges.delete(key);
          }
        }
        break;
      }

      case 'DISTANCE_REPORT': {
        const key = edgeKey(message.from, message.to);

        // A null distance means the devices went out of range: the edge is
        // dropped, not zeroed.
        if (message.distance === null) {
          this.edges.delete(key);
        } else {
          this.edges.set(key, { from: message.from, to: message.to, value: message.distance });
        }
        break;
      }

      case 'EFFECT':
        this.lastEffect = { effect: message.effect, firedAt: now };
        break;
    }
  }

  /**
   * Reports can name a device the panel never saw join — it joined while the
   * socket was down, and `USER_JOINED` does not replay. Whatever the report
   * carries is enough to start tracking it.
   */
  #upsertDevice(deviceId: string, patch: Partial<Omit<DeviceState, 'deviceId'>>) {
    const existing = this.devices.get(deviceId);

    this.devices.set(deviceId, {
      deviceId,
      location: existing?.location ?? null,
      position: existing?.position ?? null,
      updatedAt: Date.now(),
      ...patch,
    });
  }
}

/** Positions the worker has published — the only devices worth drawing. */
export function positionedDevices(devices: Iterable<DeviceState>): DeviceState[] {
  return [...devices].filter((device): device is DeviceState & { position: Position } =>
    Boolean(device.position),
  );
}
