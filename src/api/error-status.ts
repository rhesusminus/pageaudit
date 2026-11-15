import type { FastifyError } from 'fastify'

// The status an error answers with: its own when that is an error status, and 500 otherwise. Below 500 the request was
// at fault, so its message may be shown. From 500 up it is logged and its message hidden.
export const errorStatus = (error: FastifyError) =>
  error.statusCode !== undefined && error.statusCode >= 400 ? error.statusCode : 500
