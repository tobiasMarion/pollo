import { z } from 'zod'
import { dev } from '$app/environment'
import { env } from '$env/dynamic/private'
import { env as publicEnv } from '$env/dynamic/public'
import { apiBaseUrl } from '$lib/api/client'

/**
 * The panel fails on a bad environment the way the backend does — see
 * apps/backend/src/env.ts — only later: `$env/dynamic/*` is a runtime value, so
 * the check runs when the server starts (from hooks.server.ts) rather than at
 * import time, which would break a build that has none of the secrets.
 *
 * In development the dev server surfaces the throw as an error page instead of
 * exiting; production exits.
 */
const envSchema = z.object({
  GITHUB_OAUTH_CLIENT_ID: z.string().min(1),
  GITHUB_OAUTH_CLIENT_REDIRECT_URI: z.string().url(),
  /** Only set inside a compose network, where the public host does not resolve. */
  POLLO_API_INTERNAL_URL: z.string().url().optional(),
  PUBLIC_POLLO_API_URL: z.string().url().optional(),
  /** adapter-node compares the Origin of every form post against this. */
  ORIGIN: z.string().url().optional(),
})

/** Development has a working default for one and no need for the other. */
const productionEnvSchema = envSchema.extend({
  PUBLIC_POLLO_API_URL: z.string().url(),
  ORIGIN: z.string().url(),
})

export function assertEnv() {
  const schema = dev ? envSchema : productionEnvSchema
  const result = schema.safeParse({
    ...env,
    PUBLIC_POLLO_API_URL: publicEnv.PUBLIC_POLLO_API_URL,
  })

  if (!result.success) {
    const issues = result.error.issues
      .map(issue => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n')
    throw new Error(`Invalid environment variables — see .env.example:\n${issues}`)
  }
}

function read(name: string): string {
  const value = env[name]

  if (!value) {
    throw new Error(`Missing environment variable ${name} — see .env.example`)
  }

  return value
}

/**
 * Where the server reaches the API. In compose this is the service name, which
 * a browser could never resolve — hence the separate variable from the public
 * one. Falls back to the public address, which is right in development.
 */
export function internalApiUrl(): string {
  return env.POLLO_API_INTERNAL_URL || apiBaseUrl()
}

export const githubOauth = {
  get clientId() {
    return read('GITHUB_OAUTH_CLIENT_ID')
  },
  get redirectUri() {
    return read('GITHUB_OAUTH_CLIENT_REDIRECT_URI')
  },
}
