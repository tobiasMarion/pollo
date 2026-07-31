import { type MessageType, messageSchemas } from './schemas.js';

/**
 * The published documentation of a socket, rendered from the same record the
 * socket validates against. Written out by hand it drifts the first time a
 * message changes; derived, it cannot.
 */
export function messageTable(direction: { types: readonly MessageType[] }): string {
  const rows = direction.types.map((type) => {
    const schema = messageSchemas[type];
    const payload = Object.keys(schema.shape)
      .filter((field) => field !== 'type')
      .map((field) => `\`${field}\``);

    return `| \`${type}\` | ${payload.join(', ') || '—'} | ${schema.description ?? ''} |`;
  });

  return ['| type | payload | meaning |', '| --- | --- | --- |', ...rows].join('\n');
}
