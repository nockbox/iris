/**
 * SDK Wrapper for Raw Transaction Signing
 */

/**
 * Interface for raw transaction parameters
 */
export interface RawTxParams {
    rawTx: Uint8Array | string;
    notes: any[];
    spendConditions: any[];
}

/**
 * Signs a raw transaction using the wallet extension
 * Accepts either raw parameters with rawTx as Uint8Array or hex string
 * 
 * @param params - Raw transaction parameters
 * @returns Hex string of signed transaction
 */
export async function signRawTx(params: RawTxParams): Promise<string> {
    let rawTxHex: string;

    // Convert rawTx to hex string if it's a Uint8Array
    if (params.rawTx instanceof Uint8Array) {
        rawTxHex = Array.from(params.rawTx)
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
    } else {
        rawTxHex = params.rawTx;
    }

    // Call the wallet provider
    const provider = (window as any).nockchain;
    if (!provider) {
        throw new Error("Nockchain wallet not found");
    }

    return await provider.request({
        method: 'nock_signRawTx',
        params: [{
            rawTx: rawTxHex,
            notes: params.notes,
            spendConditions: params.spendConditions
        }]
    });
}
