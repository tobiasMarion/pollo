import { error } from '@sveltejs/kit';
import { ApiError, createApiClient } from '$lib/api/client';
import type { EventGraph } from '$lib/api/types';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals, fetch, parent }) => {
  const api = createApiClient({ fetch, token: locals.token });
  const { user } = await parent();

  const event = await api.getEvent(params.eventId).catch((cause) => {
    if (cause instanceof ApiError && cause.status === 404) {
      error(404, 'No event with that id.');
    }

    throw cause;
  });

  const isAdmin = event.userId === user.id;
  const watchable = isAdmin && event.status === 'OPEN';
  let graph: EventGraph = { nodes: {}, edges: [] };

  if (watchable) {
    // The graph only exists while the runtime holds the event; a miss here is
    // an empty field, not a broken page.
    graph = await api.getEventGraph(event.id).catch(() => graph);
  }

  return {
    event,
    graph,
    isAdmin,
    /**
     * The admin socket authenticates in band — a header is not an option on
     * upgrade — so the token has to reach the browser on this page. Every
     * other call keeps it server-side in the httpOnly cookie.
     */
    socketToken: watchable ? locals.token : null,
  };
};
