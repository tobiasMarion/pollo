import { describe, expect, it } from 'vitest';
import { messageSchema, safeParseJsonMessage } from './messages.js';

describe('safeParseJsonMessage', () => {
  it('parses a valid message', () => {
    const result = safeParseJsonMessage(
      JSON.stringify({ type: 'AUTHENTICATION', token: 'abc' }),
      messageSchema,
    );

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ type: 'AUTHENTICATION', token: 'abc' });
  });

  it('fails on malformed JSON without throwing', () => {
    const result = safeParseJsonMessage('{not json', messageSchema);

    expect(result.success).toBe(false);
    expect(result.error).toEqual({ message: 'Invalid JSON' });
  });

  it('fails on a payload that does not match the schema', () => {
    const result = safeParseJsonMessage(JSON.stringify({ type: 'UNKNOWN' }), messageSchema);

    expect(result.success).toBe(false);
    expect(result.data).toBeNull();
  });
});
