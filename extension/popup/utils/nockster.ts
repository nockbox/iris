import {
  NocksterDevice,
  serializeCheetahPublicKey,
  formatCheetahPubkey,
} from '@swps/nockster-js';
import type { SignMessageResponse } from '@nockbox/iris-sdk';
import { guard } from '@nockbox/iris-sdk/wasm';
import wasm from '../../shared/sdk-wasm.js';
import { initWasmModules } from '../../shared/wasm-utils';
import { assertNativeRawTx } from '../../shared/sign-raw-tx-compat';
import type { SeedAccount, SubAccount } from '../../shared/types';

const NOCKSTER_SIGN_TIMEOUT_MS = 300_000;

type NounLike = string | [NounLike, NounLike];

type WalletLike = {
  currentAccount: SubAccount | null;
  activeSeedSourceId: string | null;
  seedSources: Array<Omit<SeedAccount, 'mnemonic'>>;
};

export interface NocksterAccountRef {
  slot: number;
  path: number[];
  publicKeyHex: string;
  publicKeyBase58?: string;
}

export interface PairedNocksterAccount extends NocksterAccountRef {
  address: string;
  firmware?: string;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBytes(hex: string): Uint8Array {
  if (!/^[0-9a-fA-F]*$/.test(hex) || hex.length % 2 !== 0) {
    throw new Error('Invalid hex string');
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function tupleNoun(values: NounLike[]): NounLike {
  if (values.length === 0) return '0';
  let acc: NounLike = values[values.length - 1];
  for (let i = values.length - 2; i >= 0; i--) {
    acc = [values[i], acc];
  }
  return acc;
}

function limbToAtom(limb: bigint): string {
  if (limb < 0n) {
    throw new Error('Negative signature limb');
  }
  return limb.toString(16);
}

function schnorrSignatureToWasmSignature(chal: bigint[], sig: bigint[]): wasm.Signature {
  if (chal.length !== 8 || sig.length !== 8) {
    throw new Error('Nockster returned an invalid message signature');
  }
  const noun = tupleNoun([tupleNoun(chal.map(limbToAtom)), tupleNoun(sig.map(limbToAtom))]);
  return wasm.signatureFromNoun(noun as wasm.Noun);
}

async function withNocksterDevice<T>(fn: (device: NocksterDevice) => Promise<T>): Promise<T> {
  if (!NocksterDevice.isSupported()) {
    throw new Error('Nockster requires WebHID or Web Serial support');
  }

  const device = new NocksterDevice();
  await device.connect();
  try {
    return await fn(device);
  } finally {
    if (device.isConnected()) {
      await device.disconnect();
    }
  }
}

export async function pairNocksterAccount(): Promise<PairedNocksterAccount> {
  await initWasmModules();

  return withNocksterDevice(async device => {
    const info = await device.getInfo();
    if (info.type === 'Err') {
      throw new Error('Nockster returned an error while reading device info');
    }
    if (info.type !== 'Info') {
      throw new Error(`Unexpected Nockster response: ${info.type}`);
    }
    if (!info.has_seed) {
      throw new Error('Nockster has no seed configured');
    }

    const pub = info.cheetah_pubs[0];
    if (!pub) {
      throw new Error('Nockster did not report a public key');
    }

    await device.showAddress(pub.slot, pub.path, NOCKSTER_SIGN_TIMEOUT_MS);

    const publicKeyBytes = serializeCheetahPublicKey(pub.x, pub.y);
    const address = wasm.hashPublicKey(publicKeyBytes);

    return {
      address,
      slot: pub.slot,
      path: pub.path,
      publicKeyHex: bytesToHex(publicKeyBytes),
      publicKeyBase58: formatCheetahPubkey(pub.x, pub.y),
      firmware: `${info.fw_major}.${info.fw_minor}`,
    };
  });
}

function parseNocksterSourceRef(sourceRef?: string): Partial<NocksterAccountRef> {
  if (!sourceRef) return {};
  try {
    const parsed = JSON.parse(sourceRef) as Partial<NocksterAccountRef>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function getCurrentNocksterAccount(wallet: WalletLike): NocksterAccountRef | null {
  const current = wallet.currentAccount;
  if (!current) return null;

  const seed =
    wallet.seedSources.find(s => s.id === wallet.activeSeedSourceId) ??
    wallet.seedSources.find(s => s.accounts.some(a => a.address === current.address));
  const external = seed?.external;
  if (external?.provider !== 'nockster') return null;

  const fallback = parseNocksterSourceRef(external.sourceRef);
  const slot = external.slot ?? fallback.slot;
  const path = external.path ?? fallback.path;
  const publicKeyHex = external.publicKeyHex ?? fallback.publicKeyHex;

  if (typeof slot !== 'number' || !Array.isArray(path) || typeof publicKeyHex !== 'string') {
    throw new Error('Nockster account metadata is incomplete');
  }

  return {
    slot,
    path,
    publicKeyHex,
    publicKeyBase58: fallback.publicKeyBase58,
  };
}

export async function signRawTxWithNockster(
  rawTx: unknown,
  account: NocksterAccountRef
): Promise<wasm.NockchainTx> {
  await initWasmModules();
  assertNativeRawTx(rawTx);
  if (!guard.isRawTxV1(rawTx)) {
    throw new Error('Only v1 raw transactions are supported');
  }

  return withNocksterDevice(async device => {
    await device.selectSeed(account.slot);
    const draft = wasm.jam(wasm.rawTxToNoun(rawTx));
    const signedDraft = await device.signDraft(draft, NOCKSTER_SIGN_TIMEOUT_MS);
    const signedRawTx = wasm.rawTxFromNoun(wasm.cue(signedDraft));
    if (!guard.isRawTxV1(signedRawTx)) {
      throw new Error('Nockster returned a non-v1 transaction');
    }
    return wasm.rawTxV1ToNockchainTx(signedRawTx);
  });
}

export async function signMessageWithNockster(
  message: string,
  account: NocksterAccountRef
): Promise<SignMessageResponse> {
  await initWasmModules();
  const publicKeyBytes = hexToBytes(account.publicKeyHex);
  const publicKey = wasm.publicKeyFromBeBytes(publicKeyBytes);
  const encoded = new TextEncoder().encode(message);

  return withNocksterDevice(async device => {
    await device.selectSeed(account.slot);
    const sig = await device.signMessage(
      account.slot,
      account.path,
      encoded,
      NOCKSTER_SIGN_TIMEOUT_MS
    );
    const signature = schnorrSignatureToWasmSignature(sig.chal, sig.sig);

    try {
      const valid = wasm.verifySignature(publicKeyBytes, signature, message);
      if (!valid) {
        throw new Error('Nockster message signature did not verify');
      }
    } catch (error) {
      throw error instanceof Error ? error : new Error('Nockster message signature failed');
    }

    return { signature, publicKey };
  });
}
