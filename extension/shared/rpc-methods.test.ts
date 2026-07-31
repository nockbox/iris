import { describe, expect, it, vi } from 'vitest';

vi.mock('@nockbox/iris-sdk', () => ({
  PROVIDER_METHODS: {
    CONNECT: 'nock_connect',
    SIGN_MESSAGE: 'nock_signMessage',
    SEND_TRANSACTION: 'nock_sendTransaction',
    SIGN_TX: 'nock_signTx',
    GET_WALLET_INFO: 'nock_getWalletInfo',
  },
}));

import { INTERNAL_METHODS, PROVIDER_METHODS, RPC_METHODS } from './constants';
import type { RPCMethod } from './types';

const publicFeeMethod: RPCMethod = 'nock_estimateTransactionFee';
const internalFeeMethod: RPCMethod = 'wallet:estimateTransactionFee';

describe('fee RPC method constants', () => {
  it('keeps the public and internal wire methods in the combined method contract', () => {
    expect(PROVIDER_METHODS.ESTIMATE_TRANSACTION_FEE).toBe(publicFeeMethod);
    expect(INTERNAL_METHODS.ESTIMATE_SEND_FEE).toBe(internalFeeMethod);
    expect(RPC_METHODS.ESTIMATE_TRANSACTION_FEE).toBe(publicFeeMethod);
    expect(RPC_METHODS.ESTIMATE_SEND_FEE).toBe(internalFeeMethod);
  });
});
