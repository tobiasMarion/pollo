import type { Handle } from '@sveltejs/kit';
import { readSession } from '$lib/server/session';

export const handle: Handle = async ({ event, resolve }) => {
  event.locals.token = readSession(event.cookies);

  return resolve(event);
};
