/**
 * NOCK/NICK Currency Conversion Utilities
 * 
 * NOCK = Display unit (supports decimals)
 * NICK = Base unit (whole numbers only, what blockchain accepts)
 * 
 * 1 NOCK = 65,536 NICK (2^16)
 * 1 NICK = 0.0000152587890625 NOCK
 */

import { NOCK_TO_NICKS } from './constants';

/**
 * Convert NOCK to whole NICK with proper rounding
 * 
 * Uses Math.round() to minimize cumulative rounding errors
 * 
 * @param nockAmount - Amount in NOCK (can have decimals)
 * @returns Whole number of NICKS (what blockchain accepts)
 * 
 * @example
 * nockToNick(1.5) // 98304 NICK
 * nockToNick(100.12345) // 6561690 NICK
 */
export function nockToNick(nockAmount: number): number {
  const exactNick = nockAmount * NOCK_TO_NICKS;
  return Math.round(exactNick);
}

/**
 * Convert NICK to NOCK
 * 
 * @param nickAmount - Amount in NICK (whole number)
 * @returns Amount in NOCK
 * 
 * @example
 * nickToNock(65536) // 1.0 NOCK
 * nickToNock(98304) // 1.5 NOCK
 */
export function nickToNock(nickAmount: number): number {
  return nickAmount / NOCK_TO_NICKS;
}

/**
 * Round NOCK amount to actual sendable amount
 * 
 * This is what the user will actually send after blockchain rounding.
 * Use this on input blur to show users the exact amount.
 * 
 * @param nockAmount - Amount user entered in NOCK
 * @returns Actual NOCK amount that will be sent (after NICK rounding)
 * 
 * @example
 * roundNockToSendable(100.12345) // 100.12344360351562
 * roundNockToSendable(1.23456789) // 1.2345886230468750
 * roundNockToSendable(0.00001) // 0.0000152587890625 (1 NICK)
 */
export function roundNockToSendable(nockAmount: number): number {
  if (nockAmount === 0) return 0;
  
  const roundedNick = nockToNick(nockAmount);
  return nickToNock(roundedNick);
}

/**
 * Check if amount is too small to send (would round to 0 NICK)
 * 
 * @param nockAmount - Amount in NOCK
 * @returns true if amount rounds to 0 NICK (dust)
 * 
 * @example
 * isDustAmount(0.000001) // true (rounds to 0 NICK)
 * isDustAmount(0.00001) // false (rounds to 1 NICK)
 */
export function isDustAmount(nockAmount: number): boolean {
  if (nockAmount <= 0) return false; // Zero/negative handled separately
  const roundedNick = nockToNick(nockAmount);
  return roundedNick === 0;
}

/**
 * Format NOCK for display with smart decimal precision and thousands separators
 * 
 * Shows minimum decimals needed (up to 5 max) with commas for readability:
 * - 2.5 → "2.5" (not "2.50000")
 * - 1000.12345 → "1,000.12345"
 * - 100.1234567 → "100.12346" (rounded to 5)
 * 
 * @param nockAmount - Amount in NOCK
 * @param maxDecimals - Maximum decimal places (default: 5)
 * @returns Formatted NOCK string with minimal decimals and thousands separators
 * 
 * @example
 * formatNock(2.5) // "2.5"
 * formatNock(1000.12345) // "1,000.12345"
 * formatNock(100.00) // "100"
 */
export function formatNock(nockAmount: number, maxDecimals: number = 5): string {
  // Round to max decimals first
  const rounded = Number(nockAmount.toFixed(maxDecimals));
  
  // Split into integer and decimal parts
  const [integerPart, decimalPart] = rounded.toString().split('.');
  
  // Add thousands separators to integer part
  const formattedInteger = parseInt(integerPart).toLocaleString('en-US');
  
  // Recombine with decimal part (if exists)
  return decimalPart ? `${formattedInteger}.${decimalPart}` : formattedInteger;
}

/**
 * Format NICK with thousands separators
 * 
 * @param nickAmount - Amount in NICK
 * @returns Formatted string with commas
 * 
 * @example
 * formatNick(6561690) // "6,561,690"
 */
export function formatNick(nickAmount: number): string {
  return Math.round(nickAmount).toLocaleString('en-US');
}

/**
 * Minimum sendable amount (1 NICK in NOCK)
 */
export const MIN_SENDABLE_NOCK = 1 / NOCK_TO_NICKS; // 0.0000152587890625
