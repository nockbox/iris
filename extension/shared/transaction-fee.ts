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

function isRetryableAdvisoryFeeError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /insufficient (?:fee|funds)/i.test(message);
}

export type AdvisoryFeeBuildResult<TCandidate, TResult> = {
  result: TResult;
  candidates: readonly TCandidate[];
  retried: boolean;
};

/**
 * Retry an advisory-fee build once with a larger candidate set. Exact-fee
 * requests and unrelated errors are never retried.
 */
export async function buildWithAdvisoryFeeRetry<TCandidate, TResult>(options: {
  initialCandidates: readonly TCandidate[];
  retryCandidates: readonly TCandidate[];
  allowRetry: boolean;
  beforeRetry?: (candidates: readonly TCandidate[]) => Promise<void>;
  build: (candidates: readonly TCandidate[]) => Promise<TResult>;
}): Promise<AdvisoryFeeBuildResult<TCandidate, TResult>> {
  try {
    return {
      result: await options.build(options.initialCandidates),
      candidates: options.initialCandidates,
      retried: false,
    };
  } catch (error) {
    if (
      !options.allowRetry ||
      options.retryCandidates.length <= options.initialCandidates.length ||
      !isRetryableAdvisoryFeeError(error)
    ) {
      throw error;
    }

    await options.beforeRetry?.(options.retryCandidates);
    return {
      result: await options.build(options.retryCandidates),
      candidates: options.retryCandidates,
      retried: true,
    };
  }
}

type BuiltInputCandidate = {
  noteId: string;
  assets: number;
};

/** Resolve the exact locally-owned inputs selected by the built transaction. */
export function resolveBuiltInputSelection<TCandidate extends BuiltInputCandidate>(
  candidates: readonly TCandidate[],
  builtInputNoteIds: readonly string[]
): { inputNoteIds: string[]; selectedTotal: number } {
  const candidatesById = new Map(candidates.map(candidate => [candidate.noteId, candidate]));
  const uniqueInputIds = [...new Set(builtInputNoteIds)];
  if (uniqueInputIds.length !== builtInputNoteIds.length || uniqueInputIds.length === 0) {
    throw new Error('Built transaction contains invalid input notes');
  }

  let selectedTotal = 0;
  for (const noteId of uniqueInputIds) {
    const candidate = candidatesById.get(noteId);
    if (!candidate) {
      throw new Error('Built transaction contains an unreserved input note');
    }
    selectedTotal += candidate.assets;
  }

  if (!Number.isSafeInteger(selectedTotal) || selectedTotal < 0) {
    throw new Error('Built transaction input value exceeds the supported Nicks range');
  }

  return { inputNoteIds: uniqueInputIds, selectedTotal };
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
