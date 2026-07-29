import { redirect } from '@sveltejs/kit';
import { internalApiUrl } from '$lib/server/env';
import { takeOauthState, writeSession } from '$lib/server/session';
import type { RequestHandler } from './$types';

type Exchange = { token: string } | { error: string };

/** Trades the single-use GitHub code for a Pollo JWT. */
async function exchangeCode(fetch: typeof globalThis.fetch, code: string): Promise<Exchange> {
  try {
    const response = await fetch(new URL('/sessions/github', internalApiUrl()), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code }),
    });

    const payload = (await response.json().catch(() => null)) as {
      token?: string;
      message?: string;
    } | null;

    if (!response.ok || !payload?.token) {
      return { error: payload?.message ?? 'GitHub sign-in failed.' };
    }

    return { token: payload.token };
  } catch {
    return { error: 'Could not reach the Pollo API.' };
  }
}

/** Where GitHub sends the operator back — the path is part of the OAuth app. */
export const GET: RequestHandler = async ({ url, cookies, fetch }) => {
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const expectedState = takeOauthState(cookies);

  if (url.searchParams.has('error')) {
    redirect(303, `/login?error=${encodeURIComponent('Sign-in was cancelled on GitHub.')}`);
  }

  if (!code || !state || state !== expectedState) {
    redirect(303, `/login?error=${encodeURIComponent('That sign-in link expired. Start again.')}`);
  }

  const result = await exchangeCode(fetch, code);

  if ('error' in result) {
    redirect(303, `/login?error=${encodeURIComponent(result.error)}`);
  }

  writeSession(cookies, result.token);

  redirect(303, '/');
};
