import { describe, expect, it } from 'vitest';
import { controlMessageSchema, ingestMessageSchema, positionsMessageSchema } from './wire.js';

const location = {
  latitude: -29.7,
  longitude: -53.7,
  horizontalAccuracy: 5,
  altitude: 100,
  verticalAccuracy: 3,
};

const position = {
  uncorrected: {
    relative: { x: 0, y: 0, z: 0 },
    absolute: { x: 1, y: 2, z: 3 },
  },
  simulated: {
    relative: { x: 0.1, y: 0.2, z: 0 },
    absolute: { x: 1.1, y: 2.2, z: 3 },
  },
};

describe('ingestMessageSchema', () => {
  it('accepts every graph mutation op', () => {
    expect(ingestMessageSchema.safeParse({ op: 'JOIN', deviceId: 'd1', location }).success).toBe(
      true,
    );
    expect(
      ingestMessageSchema.safeParse({ op: 'LOCATION_UPDATE', deviceId: 'd1', location }).success,
    ).toBe(true);
    expect(
      ingestMessageSchema.safeParse({ op: 'DISTANCE', from: 'd1', to: 'd2', distance: 2.5 })
        .success,
    ).toBe(true);
    expect(
      ingestMessageSchema.safeParse({ op: 'DISTANCE', from: 'd1', to: 'd2', distance: null })
        .success,
    ).toBe(true);
    expect(ingestMessageSchema.safeParse({ op: 'LEAVE', deviceId: 'd1' }).success).toBe(true);
  });

  it('rejects unknown ops and missing fields', () => {
    expect(ingestMessageSchema.safeParse({ op: 'NOPE' }).success).toBe(false);
    expect(ingestMessageSchema.safeParse({ op: 'JOIN', deviceId: 'd1' }).success).toBe(false);
  });
});

describe('positionsMessageSchema', () => {
  it('accepts deltas and keyframes', () => {
    for (const kind of ['delta', 'keyframe']) {
      const result = positionsMessageSchema.safeParse({
        kind,
        points: [{ deviceId: 'd1', position }],
      });
      expect(result.success).toBe(true);
    }
  });

  it('rejects points without a full position', () => {
    const result = positionsMessageSchema.safeParse({
      kind: 'delta',
      points: [{ deviceId: 'd1', position: { uncorrected: position.uncorrected } }],
    });
    expect(result.success).toBe(false);
  });
});

describe('controlMessageSchema', () => {
  it('requires the event location on EVENT_OPENED', () => {
    const eventId = '7b60b1f2-3f4a-4b5c-8d6e-9f0a1b2c3d4e';

    expect(
      controlMessageSchema.safeParse({ op: 'EVENT_OPENED', eventId, latitude: 1, longitude: 2 })
        .success,
    ).toBe(true);
    expect(controlMessageSchema.safeParse({ op: 'EVENT_OPENED', eventId }).success).toBe(false);
    expect(controlMessageSchema.safeParse({ op: 'EVENT_CLOSED', eventId }).success).toBe(true);
  });
});
