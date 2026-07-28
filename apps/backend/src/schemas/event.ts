import { z } from 'zod';

export const eventTypeSchema = z.enum(['TORCH', 'SCREEN']);
export const eventStatusSchema = z.enum(['OPEN', 'FINISHED']);

export const createEventSchema = z.object({
  name: z.string().min(1),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  type: eventTypeSchema,
});

export type CreateEvent = z.infer<typeof createEventSchema>;

export const eventSchema = z.object({
  id: z.string().uuid(),
  type: eventTypeSchema,
  name: z.string(),
  status: eventStatusSchema,
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  userId: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type Event = z.infer<typeof eventSchema>;
