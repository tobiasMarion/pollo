import { describe, expect, it } from 'vitest'
import { adminInbound, adminOutbound, deviceInbound, deviceOutbound } from './directions.js'
import { messageTable } from './docs.js'
import { messageSchemas, messageTypes } from './schemas.js'

const directions = [
  ['adminOutbound', adminOutbound],
  ['adminInbound', adminInbound],
  ['deviceOutbound', deviceOutbound],
  ['deviceInbound', deviceInbound],
] as const

describe('messageTable', () => {
  it.each(directions)('renders one row per type of %s, in order', (_name, direction) => {
    const rows = messageTable(direction).split('\n').slice(2)

    expect(rows).toHaveLength(direction.types.length)
    expect(rows.map(row => row.split('|')[1]?.trim())).toEqual(
      direction.types.map(type => `\`${type}\``),
    )
  })

  it('lists the payload without the discriminator', () => {
    const row = messageTable(adminInbound)
      .split('\n')
      .find(line => line.startsWith('| `FIELD_UPDATE`'))

    expect(row).toContain('`at`, `window`, `locations`, `placed`, `left`, `edges`')
    expect(row).not.toContain('`type`')
  })

  it('marks a message that carries nothing but its type', () => {
    const row = messageTable(adminInbound)
      .split('\n')
      .find(line => line.startsWith('| `AUTHENTICATION_ACK`'))

    expect(row).toContain('| — |')
  })

  it('carries each schema description into the meaning column', () => {
    const table = messageTable(adminOutbound)

    for (const type of adminOutbound.types) {
      expect(table).toContain(messageSchemas[type].description)
    }
  })

  /**
   * The renderer leaves an empty cell for a schema with nothing to say, and an
   * empty cell in the published reference is the failure this whole approach
   * exists to prevent.
   */
  it('has something to say about every message', () => {
    const undescribed = messageTypes.filter(type => !messageSchemas[type].description)

    expect(undescribed).toEqual([])
  })
})
