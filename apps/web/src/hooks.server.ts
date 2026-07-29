import type { Handle } from '@sveltejs/kit';
import { assertEnv } from '$lib/server/env';
import { readSession } from '$lib/server/session';

// Module scope: the server refuses to come up on a bad environment instead of
// failing halfway through a sign-in.
assertEnv();

export const handle: Handle = async ({ event, resolve }) => {
  event.locals.token = readSession(event.cookies);

  return resolve(event);
};
