import { redirect } from '@sveltejs/kit'
import { resolve } from '$app/paths'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = ({ locals, url }) => {
  if (locals.token) {
    redirect(303, resolve('/'))
  }

  return { error: url.searchParams.get('error') }
}
