import type { Nicks } from '@nockbox/iris-sdk/wasm';

export type TransactionFeeBuildOptions = {
  /** Exact fee override supplied by the dApp. Omitted fees must stay undefined for WASM. */
  fee?: Nicks;
  /** Advisory fee used only to choose enough notes before WASM calculates the actual fee. */
  feeSelectionHint?: Nicks;
};

/**
 * Preserve the distinction between a dApp fee override and a wallet-generated estimate.
 * Requests created before `feeEstimated` existed are treated as explicit-fee requests.
 */
export function resolveTransactionFeeForBuild(
  displayedFee: Nicks,
  feeEstimated?: boolean
): TransactionFeeBuildOptions {
  return feeEstimated ? { feeSelectionHint: displayedFee } : { fee: displayedFee };
}
