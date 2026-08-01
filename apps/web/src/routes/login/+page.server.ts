import { redirect } from '@sveltejs/kit'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = ({ locals, url }) => {
  if (locals.token) {
    redirect(303, '/')
  }

  return { error: url.searchParams.get('error') }
}
