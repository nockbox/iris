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

const publicBuildMethod: RPCMethod = 'nock_buildSimpleTransaction';
const internalFeeMethod: RPCMethod = 'wallet:estimateTransactionFee';

describe('transaction build RPC method constants', () => {
  it('keeps the public build and internal fee methods in the combined contract', () => {
    expect(PROVIDER_METHODS.BUILD_SIMPLE_TRANSACTION).toBe(publicBuildMethod);
    expect(INTERNAL_METHODS.ESTIMATE_SEND_FEE).toBe(internalFeeMethod);
    expect(RPC_METHODS.BUILD_SIMPLE_TRANSACTION).toBe(publicBuildMethod);
    expect(RPC_METHODS.ESTIMATE_SEND_FEE).toBe(internalFeeMethod);
  });
});
