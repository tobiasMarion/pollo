/** Application close codes (the 4000-4999 range is reserved for applications). */
export const WS_CLOSE = {
  INVALID_MESSAGE: 4400,
  UNAUTHORIZED: 4401,
  NOT_FOUND: 4404,
} as const;

export type WsCloseCode = (typeof WS_CLOSE)[keyof typeof WS_CLOSE];

/**
 * The two socket endpoints, built here so a client cannot reach for a path the
 * API does not serve.
 */
export const socketPaths = {
  /** Where a device joins an event and reports what it senses. */
  join: (eventId: string) => `/events/${eventId}/join`,
  /** Where the event owner watches the field and drives it. */
  admin: (eventId: string) => `/events/${eventId}/admin`,
} as const;
