import { z } from 'zod';
import { effectSchema } from './schemas.js';

export const effectPresetSchema = z
  .object({
    id: z.string().min(1).describe('Stable key — what the panel renders its pads by.'),
    label: z.string().min(1).describe('What the operator reads on the pad.'),
    hint: z
      .string()
      .min(1)
      .describe('What actually changed, in the units the effect is expressed in.'),
    effect: effectSchema,
  })
  .describe('A ready-made cue.');

export type EffectPreset = z.infer<typeof effectPresetSchema>;

/**
 * Ready-made cues for trying effects out on a real crowd. Firing one is a
 * single tap — no numbers to fill in first, because the point of the deck is
 * to find out what a cue looks like on the field.
 *
 * Building cues by hand, with the parameters exposed, is a separate flow.
 *
 * Order is the deck order, and the panel binds the first nine to the number
 * keys, so moving an entry moves a shortcut.
 */
const presets: EffectPreset[] = [
  {
    id: 'flash',
    label: 'Flash',
    hint: 'everyone at once',
    effect: { name: 'PULSE', coordinateType: 'RELATIVE', activeTime: 0.4, spreadDelayPerUnit: 0 },
  },
  {
    id: 'ripple',
    label: 'Ripple',
    hint: '0.05 s/m',
    effect: {
      name: 'PULSE',
      coordinateType: 'RELATIVE',
      activeTime: 1.2,
      spreadDelayPerUnit: 0.05,
    },
  },
  {
    id: 'bloom',
    label: 'Bloom',
    hint: '0.12 s/m · 2 s',
    effect: { name: 'PULSE', coordinateType: 'RELATIVE', activeTime: 2, spreadDelayPerUnit: 0.12 },
  },
  {
    id: 'shockwave',
    label: 'Shockwave',
    hint: '0.01 s/m · 0.5 s',
    effect: {
      name: 'PULSE',
      coordinateType: 'RELATIVE',
      activeTime: 0.5,
      spreadDelayPerUnit: 0.01,
    },
  },
  {
    id: 'sweep-east',
    label: 'Sweep east',
    hint: 'X · 0.03 s/m',
    effect: { name: 'WAVE', direction: 'X', activeTime: 1.2, spreadDelayPerUnit: 0.03 },
  },
  {
    id: 'sweep-north',
    label: 'Sweep north',
    hint: 'Y · 0.03 s/m',
    effect: { name: 'WAVE', direction: 'Y', activeTime: 1.2, spreadDelayPerUnit: 0.03 },
  },
  {
    id: 'sweep-fast',
    label: 'Fast sweep',
    hint: 'X · 0.008 s/m',
    effect: { name: 'WAVE', direction: 'X', activeTime: 0.5, spreadDelayPerUnit: 0.008 },
  },
  {
    id: 'rise',
    label: 'Rise',
    hint: 'Z · 0.08 s/m',
    effect: { name: 'WAVE', direction: 'Z', activeTime: 1.5, spreadDelayPerUnit: 0.08 },
  },
  {
    id: 'radar',
    label: 'Radar',
    hint: '0.3 s/rad',
    effect: { name: 'ROTATE', activeTime: 1.2, spreadDelayPerRadian: 0.3 },
  },
  {
    id: 'spin',
    label: 'Fast spin',
    hint: '0.08 s/rad',
    effect: { name: 'ROTATE', activeTime: 0.6, spreadDelayPerRadian: 0.08 },
  },
  {
    id: 'spiral',
    label: 'Spiral out',
    hint: '4 m/s · 2 rad/s',
    effect: { name: 'SPIRAL', activeTime: 1.2, radialSpeed: 4, angularSpeed: 2 },
  },
  {
    id: 'coil',
    label: 'Coil',
    hint: '1.5 m/s · 6 rad/s',
    effect: { name: 'SPIRAL', activeTime: 1.5, radialSpeed: 1.5, angularSpeed: 6 },
  },
];

const deckSchema = z
  .array(effectPresetSchema)
  .refine(
    (entries) => new Set(entries.map((entry) => entry.id)).size === entries.length,
    'Preset ids must be unique — the panel keys its pads by them.',
  );

/**
 * Checked here rather than trusted: the annotation above catches a wrong shape,
 * but only the schema catches a negative duration or a repeated id, and a
 * broken cue should fail at boot instead of rendering a dead pad.
 */
export const effectPresets: EffectPreset[] = deckSchema.parse(presets);
