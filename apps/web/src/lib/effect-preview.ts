import type { Effect, Vector3 } from '$lib/api/types';

/**
 * How long after an effect fires each pixel lights up, and for how long.
 *
 * This is the panel's reading of the effect parameters, not the authority:
 * the device client renders the real thing. It exists so the operator can see
 * the shape of a cue on the field instead of guessing from four numbers.
 */

/** Seconds a pixel at `point` waits before lighting up. */
export function effectDelaySeconds(effect: Effect, point: Vector3, center: Vector3): number {
  const x = point.x - center.x;
  const y = point.y - center.y;
  const z = point.z - center.z;

  switch (effect.name) {
    case 'PULSE':
      return Math.hypot(x, y, z) * effect.spreadDelayPerUnit;

    case 'WAVE': {
      const along = effect.direction === 'X' ? x : effect.direction === 'Y' ? y : z;
      return Math.abs(along) * effect.spreadDelayPerUnit;
    }

    case 'ROTATE': {
      // atan2 returns (-π, π]; the sweep starts at one full turn's origin.
      const angle = Math.atan2(y, x) + Math.PI;
      return angle * effect.spreadDelayPerRadian;
    }

    case 'SPIRAL': {
      const radius = Math.hypot(x, y);
      const angle = Math.atan2(y, x) + Math.PI;
      const radial = effect.radialSpeed > 0 ? radius / effect.radialSpeed : 0;
      const angular = effect.angularSpeed > 0 ? angle / effect.angularSpeed : 0;
      return radial + angular;
    }
  }
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
