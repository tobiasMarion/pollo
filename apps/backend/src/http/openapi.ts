import type { FastifySchema } from 'fastify'
import { jsonSchemaTransform } from 'fastify-type-provider-zod'

/** Payload examples a route declares for its request and its responses. */
export interface RouteExamples {
  body?: unknown
  /** Keyed by path parameter name — OpenAPI carries one example per parameter. */
  params?: Record<string, unknown>
  /** Keyed by query parameter name, same reason. */
  querystring?: Record<string, unknown>
  /** Keyed by status code. */
  response?: Record<string, unknown>
}

declare module 'fastify' {
  interface FastifySchema {
    examples?: RouteExamples
  }
}

interface JsonSchema {
  properties?: Record<string, JsonSchema>
  examples?: unknown[]
  [key: string]: unknown
}

interface TransformedSchema {
  body?: JsonSchema
  params?: JsonSchema
  querystring?: JsonSchema
  response?: Record<string, JsonSchema>
  examples?: RouteExamples
}

// @fastify/swagger folds a single-entry `examples` array into the OpenAPI
// `example` keyword, for whole media types and for individual parameters
// alike, so writing the array is all that is needed here.
function setExample(schema: JsonSchema | undefined, example: unknown) {
  if (schema && example !== undefined) {
    schema.examples = [example]
  }
}

function setPropertyExamples(schema: JsonSchema | undefined, examples: Record<string, unknown>) {
  for (const [property, example] of Object.entries(examples)) {
    setExample(schema?.properties?.[property], example)
  }
}

interface TransformInput {
  schema: FastifySchema
  url: string
  route?: { websocket?: boolean }
}

/**
 * Zod 3 has no metadata slot for OpenAPI examples, so `jsonSchemaTransform`
 * cannot emit them from the route schemas. Routes declare them under
 * `schema.examples` instead, and this wrapper injects them into the JSON
 * Schema that transform produced.
 *
 * It also undoes the `hide` that @fastify/websocket stamps on every
 * `websocket: true` route — the socket protocols are documented in their
 * descriptions, and hiding them would drop half the API from the reference.
 */
export function openapiTransform(input: TransformInput) {
  const examples = input.schema?.examples
  const result = jsonSchemaTransform({
    url: input.url,
    schema: input.route?.websocket ? { ...input.schema, hide: false } : input.schema,
  })
  const schema = result.schema as TransformedSchema

  // The transform copies unknown keys verbatim, and `examples` is ours to
  // consume — it is not an OpenAPI operation field.
  delete schema.examples

  if (!examples) return result

  setExample(schema.body, examples.body)
  setPropertyExamples(schema.params, examples.params ?? {})
  setPropertyExamples(schema.querystring, examples.querystring ?? {})

  for (const [statusCode, example] of Object.entries(examples.response ?? {})) {
    setExample(schema.response?.[statusCode], example)
  }

  return result
}
