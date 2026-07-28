import { z } from 'zod';

export const locationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  horizontalAccuracy: z.number(),
  altitude: z.number(),
  verticalAccuracy: z.number(),
});

export type Location = z.infer<typeof locationSchema>;

export const exactLocationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

export type ExactLocation = z.infer<typeof exactLocationSchema>;
