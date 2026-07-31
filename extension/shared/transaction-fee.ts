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

/** Reconcile persisted transaction amounts with the fee actually chosen by WASM. */
export function resolveBuiltTransactionAmounts(
  selectedTotal: number,
  amount: Nicks,
  actualFee: number,
  sendMax = false
): { fee: number; expectedChange: number } {
  const amountNumber = Number(amount);
  if (
    !Number.isSafeInteger(selectedTotal) ||
    selectedTotal < 0 ||
    !Number.isSafeInteger(amountNumber) ||
    amountNumber < 0 ||
    !Number.isSafeInteger(actualFee) ||
    actualFee < 0
  ) {
    throw new Error('Built transaction amounts exceed the supported Nicks range');
  }

  const expectedChange = sendMax ? 0 : selectedTotal - amountNumber - actualFee;
  if (expectedChange < 0) {
    throw new Error('Built transaction fee exceeds the selected inputs');
  }

  return { fee: actualFee, expectedChange };
}
