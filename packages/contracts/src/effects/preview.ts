import type { Vector3 } from '../graph.js';
import type { Effect, EffectName, EffectOf } from './schemas.js';

/**
 * How long after a cue fires each pixel lights up, and how bright it is.
 *
 * This is the reading of the effect parameters that lets a panel draw the shape
 * of a cue on the field; the device client renders the real thing. It lives
 * beside the schemas because it is part of what defines an effect — a name and
 * a set of numbers mean nothing without it.
 */

/** Offset from the center of the pass, in meters. */
type Offset = Vector3;

/**
 * Keyed by name rather than switched on it: leaving an effect out is a type
 * error, which is the whole point of adding effects in one place.
 */
const delayByEffect: {
  [Name in EffectName]: (effect: EffectOf<Name>, offset: Offset) => number;
} = {
  PULSE: (effect, { x, y, z }) => Math.hypot(x, y, z) * effect.spreadDelayPerUnit,

  WAVE: (effect, { x, y, z }) => {
    const along = effect.direction === 'X' ? x : effect.direction === 'Y' ? y : z;

    return Math.abs(along) * effect.spreadDelayPerUnit;
  },

  ROTATE: (effect, { x, y }) => {
    // atan2 returns (-π, π]; the sweep starts at one full turn's origin.
    const angle = Math.atan2(y, x) + Math.PI;

    return angle * effect.spreadDelayPerRadian;
  },

  SPIRAL: (effect, { x, y }) => {
    const radius = Math.hypot(x, y);
    const angle = Math.atan2(y, x) + Math.PI;
    const radial = effect.radialSpeed > 0 ? radius / effect.radialSpeed : 0;
    const angular = effect.angularSpeed > 0 ? angle / effect.angularSpeed : 0;

    return radial + angular;
  },
};

/** Seconds a pixel at `point` waits before lighting up. */
export function effectDelaySeconds(effect: Effect, point: Vector3, center: Vector3): number {
  const offset = {
    x: point.x - center.x,
    y: point.y - center.y,
    z: point.z - center.z,
  };

  // The record is keyed by the same literal the effect is discriminated on, so
  // this pairing is sound; TypeScript cannot correlate the two on its own.
  const delay = delayByEffect[effect.name] as (effect: Effect, offset: Offset) => number;

  return delay(effect, offset);
}

/** 0 when dark, 1 at the peak of the pass — a quick rise and a softer fall. */
export function effectBrightness(
  effect: Effect,
  point: Vector3,
  center: Vector3,
  elapsedSeconds: number,
): number {
  const delay = effectDelaySeconds(effect, point, center);
  const progress = (elapsedSeconds - delay) / Math.max(effect.activeTime, 0.05);

  if (progress < 0 || progress > 1) return 0;

  return Math.sin(progress * Math.PI) ** 0.7;
}
