/**
 * Formatting utilities for display
 */

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
