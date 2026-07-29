import { env } from '$env/dynamic/private';

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

export const githubOauth = {
  get clientId() {
    return required('GITHUB_OAUTH_CLIENT_ID');
  },
  get redirectUri() {
    return required('GITHUB_OAUTH_CLIENT_REDIRECT_URI');
  },
};
