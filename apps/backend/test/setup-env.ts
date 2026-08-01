import { TEST_DATABASE_URL, TEST_REDIS_URL } from './test-env.js'

process.env.NODE_ENV = 'test'
process.env.LOG_LEVEL ??= 'silent'
process.env.DATABASE_URL = TEST_DATABASE_URL
process.env.REDIS_URL = TEST_REDIS_URL
process.env.JWT_SECRET = 'test-secret-0123456789abcdef'
process.env.GITHUB_OAUTH_CLIENT_ID = 'test-client-id'
process.env.GITHUB_OAUTH_CLIENT_SECRET = 'test-client-secret'
process.env.GITHUB_OAUTH_CLIENT_REDIRECT_URI = 'http://localhost:3000/api/auth/callback'
