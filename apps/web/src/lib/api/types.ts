/**
 * The wire shapes of the Pollo API, mirrored from `apps/backend/src/schemas`.
 * They are hand-kept until the contracts package ADR 0001 deferred exists —
 * the backend stays the source of truth, so change it there first.
 *
 * Timestamps are `string` here: Zod types them as `Date` on the server, but
 * they cross the wire as ISO 8601.
 */

export type EventType = 'TORCH' | 'SCREEN';
export type EventStatus = 'OPEN' | 'FINISHED';

export interface PolloEvent {
  id: string;
  type: EventType;
  name: string;
  status: EventStatus;
  latitude: number;
  longitude: number;
  userId: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateEventInput {
  name: string;
  latitude: number;
  longitude: number;
  type: EventType;
}

export interface User {
  id: string;
  name: string | null;
  email: string;
  avatarUrl: string | null;
}

/** A GPS reading reported by a device, accuracy included. */
export interface DeviceLocation {
  latitude: number;
  longitude: number;
  horizontalAccuracy: number;
  altitude: number;
  verticalAccuracy: number;
}

export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export interface PositionPair {
  relative: Vector3;
  absolute: Vector3;
}

/** `simulated` is the worker's refinement — that is what gets rendered. */
export interface Position {
  uncorrected: PositionPair;
  simulated: PositionPair;
}

export interface DeviceMetadata {
  location: DeviceLocation;
  position?: Position | null;
}

/** Directed: A→B and B→A are separate measurements. */
export interface Edge {
  from: string;
  to: string;
  value: number;
}

export interface EventGraph {
  nodes: Record<string, DeviceMetadata>;
  edges: Edge[];
}

export interface Participant {
  deviceId: string;
  location: DeviceLocation;
}

export type CoordinateType = 'ABSOLUTE' | 'RELATIVE';
export type Direction = 'X' | 'Y' | 'Z';

export type Effect =
  | {
      name: 'PULSE';
      coordinateType: CoordinateType;
      activeTime: number;
      spreadDelayPerUnit: number;
    }
  | { name: 'WAVE'; direction: Direction; activeTime: number; spreadDelayPerUnit: number }
  | { name: 'ROTATE'; activeTime: number; spreadDelayPerRadian: number }
  | { name: 'SPIRAL'; activeTime: number; radialSpeed: number; angularSpeed: number };

export type EffectName = Effect['name'];

/** Frames the admin socket sends. */
export type AdminOutboundMessage =
  | { type: 'AUTHENTICATION'; token: string }
  | { type: 'EFFECT'; effect: Effect };

/** Frames the admin socket receives — the `*_REPORT` variants carry `deviceId`. */
export type AdminInboundMessage =
  | { type: 'AUTHENTICATION_ACK' }
  | { type: 'USER_JOINED'; deviceId: string; location: DeviceLocation }
  | { type: 'USER_LEFT'; deviceId: string }
  | { type: 'LOCATION_UPDATE_REPORT'; deviceId: string; location: DeviceLocation }
  | { type: 'DISTANCE_REPORT'; from: string; to: string; distance: number | null }
  | { type: 'SET_POINT_REPORT'; deviceId: string; position: Position }
  | { type: 'EFFECT'; effect: Effect };
