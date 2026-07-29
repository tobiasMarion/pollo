import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/**
 * Liveness only, for the container healthcheck: it says the panel is serving,
 * not that the API behind it is. Mirrors `GET /health` on the backend.
 */
export const GET: RequestHandler = () => json({ status: 'ok' });
