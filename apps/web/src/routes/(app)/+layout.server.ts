import { redirect } from '@sveltejs/kit';
import { ApiError } from '$lib/api/client';
import { serverApi } from '$lib/server/api';
import { clearSession } from '$lib/server/session';
import type { LayoutServerLoad } from './$types';

/** Everything under this group needs a signed-in admin. */
export const load: LayoutServerLoad = async ({ locals, fetch, cookies }) => {
  if (!locals.token) {
    redirect(303, '/login');
  }

  const api = serverApi({ fetch, locals });

  try {
    return { user: await api.getProfile() };
  } catch (error) {
    // 401 is an expired or revoked token, 400 a deleted account: either way the
    // cookie is dead weight, so drop it instead of looping through the guard.
    if (error instanceof ApiError && (error.status === 401 || error.status === 400)) {
      clearSession(cookies);
      redirect(303, '/login');
    }

    throw error;
  }
};
