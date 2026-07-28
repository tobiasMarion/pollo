import { z } from 'zod';
import { effectSchema } from './effects.js';
import { positionSchema } from './graph.js';
import { type Location, locationSchema } from './location.js';

export const messageSchemas = {
  AUTH: z.object({
    type: z.literal('AUTHENTICATION'),
    token: z.string(),
  }),

  // Sent by the server once the admin socket is authenticated. Without it the
  // client has no way to know when it is safe to rely on report messages.
  AUTH_ACK: z.object({
    type: z.literal('AUTHENTICATION_ACK'),
  }),

  JOIN: z.object({
    type: z.literal('JOIN'),
    deviceId: z.string(),
    location: locationSchema,
  }),

  LOCATION_UPDATE: z.object({
    type: z.literal('LOCATION_UPDATE'),
    location: locationSchema,
  }),

  LOCATION_UPDATE_REPORT: z.object({
    type: z.literal('LOCATION_UPDATE_REPORT'),
    deviceId: z.string(),
    location: locationSchema,
  }),

  USER_JOINED: z.object({
    type: z.literal('USER_JOINED'),
    deviceId: z.string(),
    location: locationSchema,
  }),

  DISTANCE: z.object({
    type: z.literal('DISTANCE'),
    to: z.string(),
    distance: z.number().nullable(),
  }),

  DISTANCE_REPORT: z.object({
    type: z.literal('DISTANCE_REPORT'),
    from: z.string(),
    to: z.string(),
    distance: z.number().nullable(),
  }),

  USER_LEFT: z.object({
    type: z.literal('USER_LEFT'),
    deviceId: z.string(),
  }),

  SET_POINT: z.object({
    type: z.literal('SET_POINT'),
    position: positionSchema,
  }),

  SET_POINT_REPORT: z.object({
    type: z.literal('SET_POINT_REPORT'),
    deviceId: z.string(),
    position: positionSchema,
  }),

  EFFECT: z.object({
    type: z.literal('EFFECT'),
    effect: effectSchema,
  }),
} as const;

export const messageSchema = z.discriminatedUnion('type', [
  messageSchemas.AUTH,
  messageSchemas.AUTH_ACK,
  messageSchemas.JOIN,
  messageSchemas.LOCATION_UPDATE,
  messageSchemas.LOCATION_UPDATE_REPORT,
  messageSchemas.USER_JOINED,
  messageSchemas.USER_LEFT,
  messageSchemas.DISTANCE,
  messageSchemas.DISTANCE_REPORT,
  messageSchemas.SET_POINT,
  messageSchemas.SET_POINT_REPORT,
  messageSchemas.EFFECT,
]);

export type Message = z.infer<typeof messageSchema>;

export type MessageTypes = {
  [K in keyof typeof messageSchemas]: z.infer<(typeof messageSchemas)[K]>;
};

export type SendMessage = (message: Message) => void;

export type Subscriber = {
  deviceId: string;
  location: Location;
  sendMessage: SendMessage;
};

export type Admin = {
  userId: string;
  sendMessage: SendMessage | undefined;
};

type SafeParseJsonResult<T> =
  | { success: true; data: T; error: null }
  | { success: false; data: null; error: { message: string } | z.ZodFormattedError<T> };

/** JSON.parse + schema validation without throwing on malformed input. */
export function safeParseJsonMessage<T>(
  jsonString: string,
  schema: z.Schema<T>,
): SafeParseJsonResult<T> {
  let parsed: unknown;

  try {
    parsed = JSON.parse(jsonString);
  } catch {
    return { success: false, data: null, error: { message: 'Invalid JSON' } };
  }

  const result = schema.safeParse(parsed);

  if (!result.success) {
    return { success: false, data: null, error: result.error.format() };
  }

  return { success: true, data: result.data, error: null };
}
