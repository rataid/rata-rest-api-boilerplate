const JAKARTA_OFFSET_MS = 7 * 60 * 60 * 1000;

/**
 * ISO-8601 timestamp shifted to Asia/Jakarta (UTC+7, no DST) instead of UTC.
 */
export function nowInJakartaIso(): string {
  return new Date(Date.now() + JAKARTA_OFFSET_MS).toISOString().replace('Z', '+07:00');
}
