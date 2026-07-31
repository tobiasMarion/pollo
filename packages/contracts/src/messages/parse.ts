import type { z } from 'zod';

type SafeParseJsonResult<T> =
  | { success: true; data: T; error: null }
  | { success: false; data: null; error: { message: string } | z.ZodFormattedError<T> };

/** JSON.parse + schema validation without throwing on malformed input. */
export function safeParseJsonMessage<T>(
  jsonString: string,
  schema: z.Schema<T>,
): SafeParseJsonResult<T> {
  let parsed: unknown;

  try {
    parsed = JSON.parse(jsonString);
  } catch {
    return { success: false, data: null, error: { message: 'Invalid JSON' } };
  }

  const result = schema.safeParse(parsed);

  if (!result.success) {
    return { success: false, data: null, error: result.error.format() };
  }

  return { success: true, data: result.data, error: null };
}
