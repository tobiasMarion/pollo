import { z } from 'zod';

const coordTypesSchema = z.enum(['ABSOLUTE', 'RELATIVE']);
const directionsSchema = z.enum(['X', 'Y', 'Z']);

const effectSchemas = {
  PULSE: z.object({
    name: z.literal('PULSE'),
    coordinateType: coordTypesSchema,
    activeTime: z.number().nonnegative(),
    spreadDelayPerUnit: z.number().nonnegative(),
  }),
  WAVE: z.object({
    name: z.literal('WAVE'),
    direction: directionsSchema,
    activeTime: z.number().nonnegative(),
    spreadDelayPerUnit: z.number().nonnegative(),
  }),
  ROTATE: z.object({
    name: z.literal('ROTATE'),
    activeTime: z.number().nonnegative(),
    spreadDelayPerRadian: z.number().nonnegative(),
  }),
  SPIRAL: z.object({
    name: z.literal('SPIRAL'),
    activeTime: z.number().nonnegative(),
    radialSpeed: z.number().nonnegative(),
    angularSpeed: z.number().nonnegative(),
  }),
} as const;

export const effectSchema = z.discriminatedUnion('name', [
  effectSchemas.PULSE,
  effectSchemas.WAVE,
  effectSchemas.ROTATE,
  effectSchemas.SPIRAL,
]);

export type Effect = z.infer<typeof effectSchema>;

export type EffectTypeMap = {
  [K in keyof typeof effectSchemas]: z.infer<(typeof effectSchemas)[K]>;
};
