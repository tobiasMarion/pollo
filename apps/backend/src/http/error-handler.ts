import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify'
import { ZodError } from 'zod'
import { HttpError } from './errors.js'

export function errorHandler(error: FastifyError, request: FastifyRequest, reply: FastifyReply) {
  // Schema validation failures raised by the Zod type provider
  if (error.validation) {
    return reply.status(400).send({
      message: 'Validation error',
      issues: error.validation,
    })
  }

  // Manual schema.parse() calls inside handlers
  if (error instanceof ZodError) {
    return reply.status(400).send({
      message: 'Validation error',
      issues: error.flatten().fieldErrors,
    })
  }

  if (error instanceof HttpError) {
    return reply.status(error.statusCode).send({ message: error.message })
  }

  request.log.error({ err: error }, 'unhandled error')

  return reply.status(500).send({ message: 'Internal server error.' })
}
