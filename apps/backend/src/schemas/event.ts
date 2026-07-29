import { z } from 'zod';

export const eventTypeSchema = z
  .enum(['TORCH', 'SCREEN'])
  .describe('How devices render their pixel: `TORCH` the flashlight, `SCREEN` the display.');

export const eventStatusSchema = z
  .enum(['OPEN', 'FINISHED'])
  .describe('`OPEN` events are live in the runtime; `FINISHED` ones are history.');

// No `.describe()` on the object itself: Scalar renders a body description
// twice when the request body and its schema both carry one.
export const createEventSchema = z.object({
  name: z.string().min(1).describe('Display name of the event.'),
  latitude: z.number().min(-90).max(90).describe('Origin of the event, decimal degrees.'),
  longitude: z.number().min(-180).max(180).describe('Origin of the event, decimal degrees.'),
  type: eventTypeSchema,
});

export type CreateEvent = z.infer<typeof createEventSchema>;

export const eventSchema = z
  .object({
    id: z.string().uuid(),
    type: eventTypeSchema,
    name: z.string().describe('Display name of the event.'),
    status: eventStatusSchema,
    latitude: z
      .number()
      .min(-90)
      .max(90)
      .describe('Origin of the event — what the worker places pixels relative to.'),
    longitude: z.number().min(-180).max(180).describe('Origin of the event.'),
    userId: z.string().describe('Id of the admin who created the event.'),
    createdAt: z.date().describe('ISO 8601 timestamp.'),
    updatedAt: z.date().describe('ISO 8601 timestamp.'),
  })
  .describe('An event as persisted in Postgres.');

export type Event = z.infer<typeof eventSchema>;
