import { describe, expect, it } from 'vitest';
import type { Nicks } from '@nockbox/iris-sdk/wasm';
import {
  assertMatchingTransactionIntent,
  buildWithAdvisoryFeeRetry,
  resolveBuilderFeeSummary,
  resolveBuiltInputSelection,
  resolveBuiltTransactionAmounts,
  resolveTransactionFeeForBuild,
} from './transaction-fee';

const nicks = (value: string) => value as Nicks;

describe('transaction fee contract', () => {
  it('preserves the approved witnessless intent through signing', () => {
    expect(() =>
      assertMatchingTransactionIntent('approved-spends', 'approved-spends')
    ).not.toThrow();
    expect(() => assertMatchingTransactionIntent('approved-spends', 'changed-spends')).toThrow(
      'intent changed'
    );
  });

  it('reports an explicit fee above the minimum as the actual transaction fee', () => {
    expect(resolveBuilderFeeSummary(nicks('900'), nicks('700'), true)).toEqual({
      fee: 900,
      minimumFee: 700,
    });
  });

  it('rejects an explicit fee below the calculated minimum', () => {
    expect(() => resolveBuilderFeeSummary(nicks('600'), nicks('700'), true)).toThrow(
      'below the minimum'
    );
  });

  it('keeps an explicit dApp fee as the exact WASM override', () => {
    expect(resolveTransactionFeeForBuild(nicks('500'), false)).toEqual({
      fee: nicks('500'),
    });
  });

  it('uses a wallet estimate only as a note-selection hint', () => {
    expect(resolveTransactionFeeForBuild(nicks('500'), true)).toEqual({
      feeSelectionHint: nicks('500'),
    });
  });

  it('treats requests created before feeEstimated as explicit-fee requests', () => {
    expect(resolveTransactionFeeForBuild(nicks('500'))).toEqual({
      fee: nicks('500'),
    });
  });

  it('replaces estimated history values with the actual built fee and change', () => {
    expect(resolveBuiltTransactionAmounts(10_000, nicks('1000'), 700)).toEqual({
      fee: 700,
      expectedChange: 8_300,
    });
  });

  it('keeps send-max change at zero', () => {
    expect(resolveBuiltTransactionAmounts(10_000, nicks('9300'), 700, true)).toEqual({
      fee: 700,
      expectedChange: 0,
    });
  });

  it('retries an underfunded advisory build once with the full local note set', async () => {
    const attempts: number[][] = [];
    const reserved: number[][] = [];
    const result = await buildWithAdvisoryFeeRetry({
      initialCandidates: [1],
      retryCandidates: [1, 2, 3],
      allowRetry: true,
      beforeRetry: async candidates => {
        reserved.push([...candidates]);
      },
      build: async candidates => {
        attempts.push([...candidates]);
        if (candidates.length === 1) {
          throw new Error('Insufficient funds');
        }
        return 'built';
      },
    });

    expect(result).toEqual({ result: 'built', candidates: [1, 2, 3], retried: true });
    expect(attempts).toEqual([[1], [1, 2, 3]]);
    expect(reserved).toEqual([[1, 2, 3]]);
  });

  it('never retries an explicit-fee build', async () => {
    const build = async () => {
      throw new Error('Insufficient fee for transaction');
    };

    await expect(
      buildWithAdvisoryFeeRetry({
        initialCandidates: [1],
        retryCandidates: [1, 2],
        allowRetry: false,
        build,
      })
    ).rejects.toThrow('Insufficient fee');
  });

  it('fails after one advisory retry when all local notes are still insufficient', async () => {
    let attempts = 0;
    await expect(
      buildWithAdvisoryFeeRetry({
        initialCandidates: [1],
        retryCandidates: [1, 2],
        allowRetry: true,
        build: async () => {
          attempts += 1;
          throw new Error('Insufficient funds');
        },
      })
    ).rejects.toThrow('Insufficient funds');
    expect(attempts).toBe(2);
  });

  it('does not retry unrelated failures', async () => {
    let attempts = 0;
    await expect(
      buildWithAdvisoryFeeRetry({
        initialCandidates: [1],
        retryCandidates: [1, 2],
        allowRetry: true,
        build: async () => {
          attempts += 1;
          throw new Error('Invalid recipient');
        },
      })
    ).rejects.toThrow('Invalid recipient');
    expect(attempts).toBe(1);
  });

  it('reconciles reserved candidates to the inputs actually built by WASM', () => {
    const candidates = [
      { noteId: 'a', assets: 7_000, state: 'available' },
      { noteId: 'b', assets: 3_000, state: 'available' },
      { noteId: 'unused', assets: 1_000, state: 'available' },
    ] as const;

    expect(resolveBuiltInputSelection(candidates, ['a', 'b'])).toEqual({
      inputNoteIds: ['a', 'b'],
      selectedTotal: 10_000,
    });
    // Unsigned build reconciliation is read-only: selection alone never reserves notes.
    expect(candidates.map(candidate => candidate.state)).toEqual([
      'available',
      'available',
      'available',
    ]);
  });

  it('rejects a built input that was not locally reserved', () => {
    expect(() => resolveBuiltInputSelection([{ noteId: 'a', assets: 7_000 }], ['foreign'])).toThrow(
      'unreserved input'
    );
  });
});
