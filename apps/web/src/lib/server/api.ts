import { createApiClient } from '$lib/api/client'
import { internalApiUrl } from '$lib/server/env'

interface ServerApiContext {
  fetch: typeof globalThis.fetch
  locals: App.Locals
}

/**
 * The API client for load functions and actions: the session token comes from
 * the cookie and never leaves the server, and the API is reached at its
 * internal address.
 */
export function serverApi({ fetch, locals }: ServerApiContext) {
  return createApiClient({ fetch, token: locals.token, baseUrl: internalApiUrl() })
}
