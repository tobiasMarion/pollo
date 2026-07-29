import { fail, redirect } from '@sveltejs/kit';
import { ApiError } from '$lib/api/client';
import type { EventType } from '$lib/api/types';
import { serverApi } from '$lib/server/api';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, fetch }) => {
  const api = serverApi({ fetch, locals });

  return { events: await api.listMyEvents() };
};

function parseCoordinate(value: FormDataEntryValue | null, limit: number): number | null {
  const parsed = Number(value);

  if (typeof value !== 'string' || value.trim() === '' || !Number.isFinite(parsed)) return null;

  return Math.abs(parsed) <= limit ? parsed : null;
}

export const actions: Actions = {
  default: async ({ request, locals, fetch }) => {
    const form = await request.formData();

    const name = String(form.get('name') ?? '').trim();
    const type = String(form.get('type') ?? '') as EventType;
    const latitude = parseCoordinate(form.get('latitude'), 90);
    const longitude = parseCoordinate(form.get('longitude'), 180);
    const values = {
      name,
      type,
      latitude: String(form.get('latitude') ?? ''),
      longitude: String(form.get('longitude') ?? ''),
    };

    if (!name) {
      return fail(400, { ...values, error: 'Give the event a name.' });
    }

    if (type !== 'TORCH' && type !== 'SCREEN') {
      return fail(400, { ...values, error: 'Pick how the devices light up.' });
    }

    if (latitude === null || longitude === null) {
      return fail(400, {
        ...values,
        error: 'Coordinates must be decimal degrees — latitude ±90, longitude ±180.',
      });
    }

    const api = serverApi({ fetch, locals });
    let eventId: string;

    try {
      eventId = await api.createEvent({ name, type, latitude, longitude });
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'Could not reach the Pollo API.';
      return fail(502, { ...values, error: message });
    }

    // Opening an event is the start of running it, so land the operator on the
    // console rather than back on the list.
    redirect(303, `/events/${eventId}`);
  },
};
