import { redirect } from '@sveltejs/kit'
import { githubOauth } from '$lib/server/env'
import { writeOauthState } from '$lib/server/session'
import type { RequestHandler } from './$types'

/**
 * Starts the OAuth round trip. `user:email` lets the backend read the verified
 * primary address kept with the stable GitHub account identity.
 */
export const GET: RequestHandler = ({ cookies }) => {
  const authorizeUrl = new URL('https://github.com/login/oauth/authorize')

  authorizeUrl.searchParams.set('client_id', githubOauth.clientId)
  authorizeUrl.searchParams.set('redirect_uri', githubOauth.redirectUri)
  authorizeUrl.searchParams.set('scope', 'read:user user:email')
  authorizeUrl.searchParams.set('state', writeOauthState(cookies))

  redirect(303, authorizeUrl.toString())
}
