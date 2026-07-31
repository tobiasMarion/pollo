import { eventTypeSchema } from '@pollo/contracts';
import { fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { ApiError } from '$lib/api/client';
import { serverApi } from '$lib/server/api';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, fetch }) => {
  const api = serverApi({ fetch, locals });

  return { events: await api.listMyEvents() };
};

const COORDINATE_MESSAGE = 'Coordinates must be decimal degrees — latitude ±90, longitude ±180.';

/**
 * Form fields arrive as strings, and an empty one coerces to 0 — which is a
 * valid coordinate. Hence the explicit non-empty check before the conversion.
 */
function coordinate(limit: number) {
  return z
    .string()
    .trim()
    .min(1, COORDINATE_MESSAGE)
    .transform(Number)
    .refine((value) => Number.isFinite(value) && Math.abs(value) <= limit, COORDINATE_MESSAGE);
}

const createEventFormSchema = z.object({
  name: z.string().trim().min(1, 'Give the event a name.'),
  // The API owns which types exist; the panel only owns how it asks for one.
  type: z.enum(eventTypeSchema.options, {
    errorMap: () => ({ message: 'Pick how the devices light up.' }),
  }),
  latitude: coordinate(90),
  longitude: coordinate(180),
});

export const actions: Actions = {
  default: async ({ request, locals, fetch }) => {
    const form = await request.formData();

    // Echoed back on failure so the page can repaint what was typed.
    const values = {
      name: String(form.get('name') ?? ''),
      type: String(form.get('type') ?? ''),
      latitude: String(form.get('latitude') ?? ''),
      longitude: String(form.get('longitude') ?? ''),
    };

    const result = createEventFormSchema.safeParse(values);

    if (!result.success) {
      return fail(400, { ...values, error: result.error.issues[0].message });
    }

    const api = serverApi({ fetch, locals });
    let eventId: string;

    try {
      eventId = await api.createEvent(result.data);
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'Could not reach the Pollo API.';
      return fail(502, { ...values, error: message });
    }

    // Opening an event is the start of running it, so land the operator on the
    // console rather than back on the list.
    redirect(303, `/events/${eventId}`);
  },
};
