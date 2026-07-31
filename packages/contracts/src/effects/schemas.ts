import { z } from 'zod';
import { unionFrom } from '../union.js';

const coordTypesSchema = z
  .enum(['ABSOLUTE', 'RELATIVE'])
  .describe('`RELATIVE` measures from the event origin, `ABSOLUTE` from the earth frame.');

const directionsSchema = z
  .enum(['X', 'Y', 'Z'])
  .describe('Axis the front travels along — `X` east, `Y` north, `Z` up.');

const activeTime = z
  .number()
  .nonnegative()
  .describe('How long a single pixel stays lit once its turn comes, in seconds.');

/**
 * Every effect Pollo knows how to fire. This record is the source: the union
 * below, the type inferred from it, the deck of presets, the panel's preview
 * math and the documented list of names all derive from these keys — a new
 * effect is one entry here and whatever the type errors then ask for.
 */
export const effectSchemas = {
  PULSE: z
    .object({
      name: z.literal('PULSE'),
      coordinateType: coordTypesSchema,
      activeTime,
      spreadDelayPerUnit: z
        .number()
        .nonnegative()
        .describe('Delay per meter away from the center — 0 lights everyone at once.'),
    })
    .describe('A ring travelling outwards from the center of the field.'),

  WAVE: z
    .object({
      name: z.literal('WAVE'),
      direction: directionsSchema,
      activeTime,
      spreadDelayPerUnit: z
        .number()
        .nonnegative()
        .describe('Delay per meter along the axis, in seconds.'),
    })
    .describe('A front sweeping across the field along one axis.'),

  ROTATE: z
    .object({
      name: z.literal('ROTATE'),
      activeTime,
      spreadDelayPerRadian: z
        .number()
        .nonnegative()
        .describe('Delay per radian of the sweep, in seconds.'),
    })
    .describe('A radar arm sweeping around the center.'),

  SPIRAL: z
    .object({
      name: z.literal('SPIRAL'),
      activeTime,
      radialSpeed: z.number().nonnegative().describe('How fast the arm grows outwards, in m/s.'),
      angularSpeed: z.number().nonnegative().describe('How fast the arm turns, in rad/s.'),
    })
    .describe('A radar arm that also travels outwards as it turns.'),
} as const;

export const effectSchema = unionFrom('name', effectSchemas);

export type Effect = z.infer<typeof effectSchema>;
export type EffectName = Effect['name'];

/** One member of the union, picked by name — what the per-effect records key on. */
export type EffectOf<Name extends EffectName> = Extract<Effect, { name: Name }>;

export const effectNames = Object.keys(effectSchemas) as [EffectName, ...EffectName[]];
