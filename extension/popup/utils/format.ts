/**
 * Formatting utilities for display
 */

/**
 * Parse a formatted number string (with commas) to a number
 */
export function parseAmount(value: string): number {
  const cleaned = value.replace(/,/g, '');
  return parseFloat(cleaned) || 0;
}

/**
 * Format a number string with thousand separators
 */
export function formatWithCommas(value: string): string {
  const cleaned = value.replace(/[^0-9.]/g, '');
  if (!cleaned) return '';

  const parts = cleaned.split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return parts.join('.');
}

/**
 * Truncate an address for display
 * @param address - Full address string
 * @param startChars - Number of characters to show at start (default: 6)
 * @param endChars - Number of characters to show at end (default: 6)
 * @returns Truncated address like "89dF13...sw5Lvw" or empty string if no address
 */
export function truncateAddress(
  address: string | null | undefined,
  startChars: number = 6,
  endChars: number = 6
): string {
  if (!address) return '';
  if (address.length <= startChars + endChars) return address;
  return `${address.slice(0, startChars)}...${address.slice(-endChars)}`;
}

/**
 * Format a date as a relative time string (e.g., "34m ago", "2d ago")
 * @param date - The date to format
 * @returns Relative time string
 */
export function formatTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);

  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * Format a timestamp as UTC date/time string
 * @param timestamp - Timestamp in milliseconds since epoch
 * @returns Formatted UTC string (e.g., "Jan 18, 2025, 14:23:45 UTC")
 */
export function formatUTCTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  return (
    date.toLocaleString('en-US', {
      timeZone: 'UTC',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }) + ' UTC'
  );
}
