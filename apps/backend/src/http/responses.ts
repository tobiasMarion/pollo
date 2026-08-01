import { z } from 'zod'

/**
 * The error envelopes `errorHandler` emits. Routes list the ones they can
 * actually produce so they show up in the generated OpenAPI document.
 *
 * These are parsed by the response serializer, not only rendered as docs: a
 * schema narrower than what a handler really sends turns the error into a 500.
 * Descriptions are per route — call `.describe()` on the way in.
 */

export const errorResponseSchema = z.object({
  message: z.string().describe('Human-readable reason for the failure.'),
})

export const validationErrorResponseSchema = z.object({
  message: z.string().describe('Always `Validation error`.'),
  issues: z
    .unknown()
    .describe(
      'Zod issues — an array for request schema failures, an object keyed by ' +
        'field name for a `schema.parse()` inside a handler.',
    ),
})

/** Illustrative payloads, reused as OpenAPI examples across routes. */
export const errorExamples = {
  invalidUuid: {
    message: 'Validation error',
    issues: [
      {
        keyword: 'invalid_string',
        instancePath: '/eventId',
        schemaPath: '#/eventId/invalid_string',
        params: {
          issue: {
            validation: 'uuid',
            code: 'invalid_string',
            message: 'Invalid uuid',
            path: ['eventId'],
          },
        },
        message: 'Invalid uuid',
      },
    ],
  },
  invalidToken: { message: 'Invalid auth token' },
  eventNotFound: { message: 'Event not found' },
} as const
