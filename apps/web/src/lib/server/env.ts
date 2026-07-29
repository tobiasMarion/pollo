import { env } from '$env/dynamic/private';
import { apiBaseUrl } from '$lib/api/client';

/**
 * The backend fails fast on a bad environment; the panel does the same, only
 * lazily — reading these at import time would break the build, which runs
 * without any of the secrets.
 */
function required(name: string): string {
  const value = env[name];

  if (!value) {
    throw new Error(`Missing environment variable ${name} — see .env.example`);
  }

  return value;
}

/**
 * Where the server reaches the API. In compose this is the service name, which
 * a browser could never resolve — hence the separate variable from the public
 * one. Falls back to the public address, which is right in development.
 */
export function internalApiUrl(): string {
  return env.POLLO_API_INTERNAL_URL || apiBaseUrl();
}

export const githubOauth = {
  get clientId() {
    return required('GITHUB_OAUTH_CLIENT_ID');
  },
  get redirectUri() {
    return required('GITHUB_OAUTH_CLIENT_REDIRECT_URI');
  },
};
