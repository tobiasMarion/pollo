/** Five decimals is ~1 m — the precision an event origin is worth. */
export function formatCoordinates(latitude: number, longitude: number): string {
  return `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
}

const dateFormatter = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

export function formatTimestamp(isoDate: string): string {
  return dateFormatter.format(new Date(isoDate));
}

export function formatMeters(value: number): string {
  return `${value.toFixed(1)} m`;
}
