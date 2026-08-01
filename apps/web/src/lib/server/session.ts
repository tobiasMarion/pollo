import type { Cookies } from '@sveltejs/kit'
import { dev } from '$app/environment'

/**
 * The JWT never reaches client-side JavaScript: it lives in an httpOnly
 * cookie and is attached to API calls on the server. `lax` is the tightest
 * policy that still survives the redirect back from GitHub.
 */
const SESSION_COOKIE = 'pollo_session'

/** Matches the 7-day expiry the backend signs the token with. */
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7

const baseCookieOptions = {
  path: '/',
  httpOnly: true,
  sameSite: 'lax',
  secure: !dev,
} as const

export function readSession(cookies: Cookies): string | null {
  return cookies.get(SESSION_COOKIE) ?? null
}

export function writeSession(cookies: Cookies, token: string) {
  cookies.set(SESSION_COOKIE, token, { ...baseCookieOptions, maxAge: SESSION_MAX_AGE_SECONDS })
}

export function clearSession(cookies: Cookies) {
  cookies.delete(SESSION_COOKIE, baseCookieOptions)
}

/**
 * CSRF for the OAuth round trip: the value handed to GitHub must come back
 * matching the one we stored, or the callback is not ours to trust.
 */
const OAUTH_STATE_COOKIE = 'pollo_oauth_state'
const OAUTH_STATE_MAX_AGE_SECONDS = 60 * 10

export function writeOauthState(cookies: Cookies): string {
  const state = crypto.randomUUID()
  cookies.set(OAUTH_STATE_COOKIE, state, {
    ...baseCookieOptions,
    maxAge: OAUTH_STATE_MAX_AGE_SECONDS,
  })
  return state
}

export function takeOauthState(cookies: Cookies): string | null {
  const state = cookies.get(OAUTH_STATE_COOKIE) ?? null
  cookies.delete(OAUTH_STATE_COOKIE, baseCookieOptions)
  return state
}
