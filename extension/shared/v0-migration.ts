/**
 * Minimal v0→v1 migration helpers.
 *
 * Intentionally scoped: this does NOT add full v0 wallet support.
 * It only helps derive likely legacy (v0) key/address candidates from a seedphrase so the caller
 * can locate funds and migrate them.
 */


async function deriveMasterKeyFromSeedphraseV0(seedphrase: string, passphrase: string) {
  const mod = await import('@nockbox/iris-wasm/iris_wasm.js');
  if (typeof (mod as any).deriveMasterKeyFromSeedphraseV0 === 'function') {
    return (mod as any).deriveMasterKeyFromSeedphraseV0(seedphrase, passphrase);
  }
  if (typeof (mod as any).deriveMasterKeyFromSeedphraseUnchecked === 'function') {
    return (mod as any).deriveMasterKeyFromSeedphraseUnchecked(seedphrase, passphrase);
  }
  throw new Error('Missing seedphrase derivation API in iris-wasm');
}

import { publicKeyToPKHDigest } from './address-encoding.js';
import { base58 } from '@scure/base';
import { initWasmModules } from './wasm-utils.js';

export type V0Candidate = {
  label: 'master' | 'child0' | 'hard0';
  /** Base58-encoded wallet address (Cheetah pubkey) used by the balance RPC. */
  addressB58: string;
  /** Base58 digest string of the public key hash (PKH). */
  pkhDigest: string;
  /** 32-byte private key (required to sign spends). */
  privateKey: Uint8Array;
  /** 97-byte public key. */
  publicKey: Uint8Array;
};

/**
 * Derive a small set of plausible legacy address candidates from a seedphrase.
 *
 * Why multiple? Historically, wallets have differed on whether "account 0" is the master key,
 * SLIP-10 child(0), or hardened child(0). We try all three and let the caller query balances to
 * discover which one actually has notes.
 */
export async function deriveV0CandidatesFromSeedphrase(
  seedphrase: string,
  passphrase: string = ''
): Promise<V0Candidate[]> {
  await initWasmModules();

  const master = await deriveMasterKeyFromSeedphraseV0(seedphrase, passphrase);
  const child0 = master.deriveChild(0);
  const hard0 = master.deriveChild(1 << 31);

  function toCandidate(label: V0Candidate['label'], key: any): V0Candidate {
    const publicKey = new Uint8Array(key.publicKey);
    const privateKey = key.privateKey
      ? new Uint8Array(key.privateKey)
      : (() => {
          throw new Error('Derived key missing private key');
        })();

    return {
      label,
      addressB58: base58.encode(publicKey),
      pkhDigest: publicKeyToPKHDigest(publicKey),
      privateKey,
      publicKey,
    };
  }

  const candidates = [
    toCandidate('master', master),
    toCandidate('child0', child0),
    toCandidate('hard0', hard0),
  ];

  // Free WASM objects
  hard0.free();
  child0.free();
  master.free();

  return candidates;
}
