import { describe, expect, it } from 'vitest'
import { apiUrl } from './client'

describe('apiUrl', () => {
  it('preserves a reverse-proxy base path', () => {
    expect(apiUrl('/events/123', 'https://pollo.example/api').toString()).toBe(
      'https://pollo.example/api/events/123',
    )
  })

  it('keeps the root-based development URL unchanged', () => {
    expect(apiUrl('/health', 'http://localhost:3333').toString()).toBe(
      'http://localhost:3333/health',
    )
  })
})
