/**
 * Wallet Styles - single source of truth for account icon styles and colors
 *
 * Icons are identified by stable string ids (e.g. 'sun', 'gaze-left') that are
 * persisted on each account in the vault. Vaults written by older versions may
 * still hold numeric ids (1-15); `normalizeIconStyleId` maps the surviving ones
 * to their string id and retired ones to the default.
 *
 * Two orders are derived from the registry below:
 *  - Picker order (`WALLET_ICONS` as-is): icons of the same visual family sit
 *    next to each other so users can compare close variants.
 *  - Assignment order (`ICON_ASSIGNMENT_ORDER`): a round-robin across families
 *    so consecutively created wallets get visually distinct icons.
 */

export interface WalletIconDef {
  /** Stable id stored in the vault; asset file is wallet-icon-<id>.svg */
  id: string;
  /** Visual family; icons of one family look alike and are grouped in the picker */
  family: string;
}

/** All available icon styles, in the order shown in the customization picker. */
export const WALLET_ICONS: readonly WalletIconDef[] = [
  // Classic petal frames (original set)
  { id: 'style-1', family: 'classic' }, // default
  { id: 'style-2', family: 'classic' },
  { id: 'style-3', family: 'classic' },
  { id: 'style-8', family: 'classic' },
  { id: 'style-14', family: 'classic' },
  // Gaze directions
  { id: 'gaze-left', family: 'gaze' },
  { id: 'gaze-right', family: 'gaze' },
  { id: 'gaze-down', family: 'gaze' },
  // Eye in different frames
  { id: 'squircle-eye', family: 'eye' },
  { id: 'seal-eye', family: 'eye' },
  { id: 'quatrefoil-eye', family: 'eye' },
  { id: 'cat-eye', family: 'eye' },
  // Concentric shapes
  { id: 'ring', family: 'rings' },
  { id: 'target', family: 'rings' },
  // Celestial
  { id: 'sun', family: 'celestial' },
  { id: 'pinwheel-sun', family: 'celestial' },
  { id: 'moon', family: 'celestial' },
  { id: 'north-star', family: 'celestial' },
  { id: 'orbit', family: 'celestial' },
  // Spirals
  { id: 'spiral', family: 'spiral' },
  { id: 'fibonacci', family: 'spiral' },
  { id: 'seal-fibonacci', family: 'spiral' },
  // Standalone symbols
  { id: 'snowflake', family: 'symbol' },
  { id: 'gem', family: 'symbol' },
  { id: 'heart', family: 'symbol' },
  { id: 'bolt', family: 'symbol' },
  { id: 'keyhole', family: 'symbol' },
  // Nockchain brand
  { id: 'nock-n', family: 'brand' },
  { id: 'nock-n-round', family: 'brand' },
] as const;

/**
 * Account icon colors, in the order shown in the customization picker
 * (rainbow starting at the default yellow).
 */
export const ACCOUNT_COLORS = [
  '#FFC413', // yellow (default)
  '#EF7A2C', // orange
  '#EF2C2F', // red
  '#EF2C6A', // raspberry
  '#EF2CB1', // pink
  '#EF2CE3', // magenta
  '#C42CEF', // fuchsia
  '#9A2CEF', // violet
  '#3C2CEF', // purple
  '#2C6AEF', // dark blue
  '#2C9AEF', // blue
  '#2CC4EF', // sky
  '#2CEFE3', // turquoise
  '#2CEFB1', // mint
  '#2CEF5E', // spring green
  '#7AEF2C', // lime
  '#96B839', // olive green
] as const;

export interface WalletStyle {
  iconStyleId: string;
  iconColor: string;
}

/** Style of the very first wallet, and fallback whenever a style is missing. */
export const DEFAULT_WALLET_STYLE: WalletStyle = {
  iconStyleId: WALLET_ICONS[0].id,
  iconColor: ACCOUNT_COLORS[0],
};

/**
 * Numeric icon ids written by older versions. Retired styles (4-7, 9-13, 15)
 * have no entry and resolve to the default.
 */
const LEGACY_ICON_IDS: Record<number, string> = {
  1: 'style-1',
  2: 'style-2',
  3: 'style-3',
  8: 'style-8',
  14: 'style-14',
};

const KNOWN_ICON_IDS = new Set(WALLET_ICONS.map(icon => icon.id));

/** Resolves a stored icon style (string, legacy number, or missing) to a valid id. */
export function normalizeIconStyleId(value: number | string | undefined | null): string {
  if (typeof value === 'string' && KNOWN_ICON_IDS.has(value)) return value;
  if (typeof value === 'number' && LEGACY_ICON_IDS[value]) return LEGACY_ICON_IDS[value];
  return DEFAULT_WALLET_STYLE.iconStyleId;
}

/**
 * Icon order used when auto-assigning styles to new wallets: a round-robin
 * across families (first icon of each family, then second of each, ...) so
 * back-to-back wallets never get two icons from the same family.
 */
export const ICON_ASSIGNMENT_ORDER: readonly string[] = (() => {
  const families: string[][] = [];
  const byFamily = new Map<string, string[]>();
  for (const icon of WALLET_ICONS) {
    let bucket = byFamily.get(icon.family);
    if (!bucket) {
      bucket = [];
      byFamily.set(icon.family, bucket);
      families.push(bucket);
    }
    bucket.push(icon.id);
  }
  const order: string[] = [];
  for (let round = 0; order.length < WALLET_ICONS.length; round++) {
    for (const bucket of families) {
      if (round < bucket.length) order.push(bucket[round]);
    }
  }
  return order;
})();

/**
 * Color stride for auto-assignment: stepping the rainbow by 7 keeps
 * consecutive wallets far apart in hue. 7 is coprime with the palette size,
 * so all colors are visited before any repeats.
 */
const COLOR_ASSIGNMENT_STRIDE = 7;

/** Total number of distinct icon/color combinations. */
export const TOTAL_STYLE_COMBINATIONS = WALLET_ICONS.length * ACCOUNT_COLORS.length;

/**
 * Deterministic style for the n-th auto-assigned wallet (0-based).
 *
 * Icons cycle through `ICON_ASSIGNMENT_ORDER` and colors through the strided
 * rainbow. Because the icon count (29) and color count (17) are coprime, the
 * sequence only repeats a combination after all `TOTAL_STYLE_COMBINATIONS`
 * (493) have been used. Index 0 is the default style.
 */
export function getPresetWalletStyle(index: number): WalletStyle {
  return {
    iconStyleId: ICON_ASSIGNMENT_ORDER[index % ICON_ASSIGNMENT_ORDER.length],
    iconColor: ACCOUNT_COLORS[(index * COLOR_ASSIGNMENT_STRIDE) % ACCOUNT_COLORS.length],
  };
}
