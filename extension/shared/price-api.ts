/**
 * Price API for fetching NOCK token price from CoinGecko
 */

// CoinGecko API configuration
const COINGECKO_API_BASE = 'https://api.coingecko.com/api/v3';

const NOCK_COIN_ID = 'nockchain';

export interface PriceData {
  usd: number;
  usd_24h_change: number;
}

/**
 * Fetch current NOCK price from CoinGecko
 * @returns Price in USD and 24h change percentage
 */
export async function fetchNockPrice(): Promise<PriceData> {
  try {
    const response = await fetch(
      `${COINGECKO_API_BASE}/simple/price?ids=${NOCK_COIN_ID}&vs_currencies=usd&include_24hr_change=true`
    );

    if (!response.ok) {
      throw new Error(`CoinGecko API error: ${response.status}`);
    }

    const data = await response.json();

    // Check if the coin exists in the response
    if (!data[NOCK_COIN_ID]) {
      throw new Error(`Coin ${NOCK_COIN_ID} not found on CoinGecko`);
    }

    const coinData = data[NOCK_COIN_ID];

    return {
      usd: coinData.usd || 0,
      usd_24h_change: coinData.usd_24h_change || 0,
    };
  } catch (error) {
    console.error('[PriceAPI] Failed to fetch price:', error);

    // Return fallback data instead of throwing
    // This prevents the UI from breaking if the API is down
    return {
      usd: 0,
      usd_24h_change: 0,
    };
  }
}

/**
 * Format price for display
 * @param price - Price in USD
 * @returns Formatted price string (e.g., "$1.23")
 */
export function formatPrice(price: number): string {
  if (price === 0) return '$0.00';

  // For prices < $0.01, show more decimals
  if (price < 0.01) {
    return `$${price.toFixed(6)}`;
  }

  // For normal prices, show 2 decimals
  return `$${price.toFixed(2)}`;
}

/**
 * Format percentage change for display
 * @param change - Percentage change
 * @returns Formatted percentage string (e.g., "+5.23%")
 */
export function formatPercentChange(change: number): string {
  const formatted = Math.abs(change).toFixed(2);
  return change >= 0 ? `+${formatted}%` : `-${formatted}%`;
}
