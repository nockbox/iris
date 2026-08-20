import { describe, expect, it } from 'vitest';
import { ApprovedOriginsState } from './approved-origins-state';

describe('ApprovedOriginsState', () => {
  it('orders a slow approval before reset so reset wins durably and in memory', async () => {
    let releaseApproval!: () => void;
    let approvalWriteStarted!: () => void;
    const approvalStarted = new Promise<void>(resolve => {
      approvalWriteStarted = resolve;
    });
    const approvalGate = new Promise<void>(resolve => {
      releaseApproval = resolve;
    });
    let durableOrigins: string[] = [];
    const writes: string[][] = [];
    const state = new ApprovedOriginsState(async origins => {
      writes.push(origins);
      if (origins.includes('https://dapp.example')) {
        approvalWriteStarted();
        await approvalGate;
      }
      durableOrigins = origins;
    });

    const approvalGeneration = state.captureGeneration();
    const approval = state.approve('https://dapp.example', approvalGeneration);
    await approvalStarted;

    const resetGeneration = state.beginReset();
    const reset = state.runReset(resetGeneration, async () => {
      writes.push([]);
      durableOrigins = [];
    });
    releaseApproval();

    await expect(approval).rejects.toThrow('Wallet authorization changed');
    await reset;
    state.finishReset(resetGeneration);

    expect(writes).toEqual([['https://dapp.example'], []]);
    expect(durableOrigins).toEqual([]);
    expect(state.has('https://dapp.example')).toBe(false);
  });

  it('publishes approve and revoke mutations only after persistence succeeds', async () => {
    let fail = true;
    const state = new ApprovedOriginsState(async () => {
      if (fail) throw new Error('storage failed');
    });

    await expect(state.approve('https://dapp.example')).rejects.toThrow('storage failed');
    expect(state.has('https://dapp.example')).toBe(false);

    fail = false;
    await state.approve('https://dapp.example');
    expect(state.has('https://dapp.example')).toBe(true);

    fail = true;
    await expect(state.revoke('https://dapp.example')).rejects.toThrow('storage failed');
    expect(state.has('https://dapp.example')).toBe(true);
  });
});
