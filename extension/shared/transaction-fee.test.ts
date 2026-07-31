import { describe, expect, it } from 'vitest';
import type { Nicks } from '@nockbox/iris-sdk/wasm';
import { resolveBuiltTransactionAmounts, resolveTransactionFeeForBuild } from './transaction-fee';

const nicks = (value: string) => value as Nicks;

describe('transaction fee contract', () => {
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
});
