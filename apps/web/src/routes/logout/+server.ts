import { redirect } from '@sveltejs/kit'
import { clearSession } from '$lib/server/session'
import type { RequestHandler } from './$types'

export const POST: RequestHandler = ({ cookies }) => {
  clearSession(cookies)

  redirect(303, '/login')
}
