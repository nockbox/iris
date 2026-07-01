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
const NOCKSTER_HID_VENDOR_ID = 0x303a;
const NOCKSTER_HID_PRODUCT_ID = 0x2001;
const NOCKSTER_SERIAL_VENDOR_ID = 0x303a;
const NOCKSTER_SERIAL_PRODUCT_ID = 0x1001;

type NounLike = string | [NounLike, NounLike];
export type NocksterTransportMode = 'hid' | 'serial';
type NocksterTransportPreference = NocksterTransportMode | 'auto';
type ConnectedNocksterDevice = {
  device: NocksterDevice;
  transport: NocksterTransportMode;
};
type SerialApiWithGetPorts = NonNullable<Navigator['serial']> & {
  getPorts?: () => Promise<SerialPort[]>;
};
type SerialPortWithInfo = SerialPort & {
  getInfo?: () => { usbVendorId?: number; usbProductId?: number };
};
type HidDeviceWithIds = HIDDevice & {
  vendorId?: number;
  productId?: number;
};

type SerialTransportLike = {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  write(data: Uint8Array): Promise<void>;
  startReading(onData: (data: Uint8Array) => void): void;
  isConnected(): boolean;
};

type WalletLike = {
  currentAccount: SubAccount | null;
  activeSeedSourceId: string | null;
  seedSources: Array<Omit<SeedAccount, 'mnemonic'>>;
};
type NocksterInfoResponse = Extract<Awaited<ReturnType<NocksterDevice['getInfo']>>, { type: 'Info' }>;

export interface NocksterAccountRef {
  slot: number;
  path: number[];
  publicKeyHex: string;
  publicKeyBase58?: string;
  transport?: NocksterTransportMode;
}

export interface PairedNocksterAccount extends NocksterAccountRef {
  address: string;
  firmware?: string;
}

export class NocksterDeviceLockedError extends Error {
  attemptsRemaining?: number;

  constructor(attemptsRemaining?: number) {
    const attempts =
      typeof attemptsRemaining === 'number' ? ` ${attemptsRemaining} attempts remaining.` : '';
    super(`Nockster is locked. Enter your device PIN to unlock it.${attempts}`);
    this.name = 'NocksterDeviceLockedError';
    this.attemptsRemaining = attemptsRemaining;
  }
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

class WebSerialNocksterTransport implements SerialTransportLike {
  private port: SerialPort | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private reading = false;

  async connect(): Promise<void> {
    if (!navigator.serial) {
      throw new Error('Web Serial API not supported in this browser');
    }

    const serial = navigator.serial as SerialApiWithGetPorts;
    const port = (await findAuthorizedSerialPort(serial)) ?? (await serial.requestPort());

    await port.open({ baudRate: 115200 });
    if (!port.writable) {
      await port.close();
      throw new Error('Selected serial device is not writable');
    }

    this.port = port;
    this.writer = port.writable.getWriter();
  }

  async disconnect(): Promise<void> {
    const reader = this.reader;
    this.reader = null;
    this.reading = false;

    if (reader) {
      try {
        await reader.cancel();
      } catch {
        // Ignore disconnect races.
      }
    }

    const writer = this.writer;
    this.writer = null;
    if (writer) {
      try {
        await writer.close();
      } catch {
        // Ignore disconnect races.
      } finally {
        try {
          writer.releaseLock();
        } catch {
          // Ignore already-released locks.
        }
      }
    }

    const port = this.port;
    this.port = null;
    if (port) {
      try {
        await port.close();
      } catch {
        // Ignore disconnect races.
      }
    }
  }

  async write(data: Uint8Array): Promise<void> {
    if (!this.writer) {
      throw new Error('Serial device not connected');
    }
    await this.writer.write(data);
  }

  startReading(onData: (data: Uint8Array) => void): void {
    if (this.reading) return;
    this.reading = true;
    void this.readLoop(onData);
  }

  isConnected(): boolean {
    return Boolean(this.port && this.writer);
  }

  private async readLoop(onData: (data: Uint8Array) => void): Promise<void> {
    const port = this.port;
    if (!port?.readable) return;

    const reader = port.readable.getReader();
    this.reader = reader;

    try {
      while (this.reading) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) onData(value);
      }
    } catch (error) {
      console.warn('[Nockster] Serial read failed:', error);
    } finally {
      if (this.reader === reader) {
        this.reader = null;
      }
      this.reading = false;
      try {
        reader.releaseLock();
      } catch {
        // Ignore already-released locks.
      }
    }
  }
}

function isNocksterSerialPort(port: SerialPort): boolean {
  const info = (port as SerialPortWithInfo).getInfo?.();
  if (!info?.usbVendorId) return false;
  return (
    info.usbVendorId === NOCKSTER_SERIAL_VENDOR_ID &&
    (!info.usbProductId || info.usbProductId === NOCKSTER_SERIAL_PRODUCT_ID)
  );
}

async function findAuthorizedSerialPort(serial: SerialApiWithGetPorts): Promise<SerialPort | null> {
  const ports = (await serial.getPorts?.()) ?? [];
  return ports.find(isNocksterSerialPort) ?? (ports.length === 1 ? ports[0] : null);
}

function isNocksterHidDevice(device: HIDDevice): boolean {
  const withIds = device as HidDeviceWithIds;
  return (
    withIds.vendorId === NOCKSTER_HID_VENDOR_ID &&
    withIds.productId === NOCKSTER_HID_PRODUCT_ID
  );
}

function isNoHidDeviceSelected(error: unknown): boolean {
  if (error instanceof DOMException) {
    return error.name === 'NotFoundError';
  }
  return error instanceof Error && error.message === 'No HID device selected';
}

async function ensureNocksterUnlocked(device: NocksterDevice, pin?: string): Promise<void> {
  const status = await device.getLockStatus();
  if (!status.locked) return;

  if (!pin) {
    throw new NocksterDeviceLockedError(status.attempts_remaining);
  }

  await device.unlock(pin);
  const nextStatus = await device.getLockStatus();
  if (nextStatus.locked) {
    throw new NocksterDeviceLockedError(nextStatus.attempts_remaining);
  }
}

async function connectHidNocksterDevice(): Promise<NocksterDevice> {
  if (!navigator.hid) {
    throw new Error('WebHID API not supported in this browser');
  }

  const device = new NocksterDevice();
  const authorizedDevices = await navigator.hid.getDevices();
  const authorizedNockster = authorizedDevices.find(isNocksterHidDevice);
  if (authorizedNockster) {
    await device.connectHidDevice(authorizedNockster);
    return device;
  }

  const selectedDevices = await navigator.hid.requestDevice({
    filters: [{ vendorId: NOCKSTER_HID_VENDOR_ID, productId: NOCKSTER_HID_PRODUCT_ID }],
  });
  if (!selectedDevices.length) {
    throw new Error('No HID device selected');
  }

  await device.connectHidDevice(selectedDevices[0]);
  return device;
}

async function connectSerialNocksterDevice(): Promise<NocksterDevice> {
  const serialDevice = new NocksterDevice(new WebSerialNocksterTransport());
  await serialDevice.connect();
  return serialDevice;
}

async function connectNocksterDevice(
  preferredTransport: NocksterTransportPreference = 'auto'
): Promise<ConnectedNocksterDevice> {
  if (preferredTransport === 'hid') {
    return { device: await connectHidNocksterDevice(), transport: 'hid' };
  }
  if (preferredTransport === 'serial') {
    return { device: await connectSerialNocksterDevice(), transport: 'serial' };
  }

  if (navigator.hid) {
    try {
      return { device: await connectHidNocksterDevice(), transport: 'hid' };
    } catch (error) {
      if (!isNoHidDeviceSelected(error) || !navigator.serial) {
        throw error;
      }
    }
  }

  return { device: await connectSerialNocksterDevice(), transport: 'serial' };
}

async function withNocksterDevice<T>(
  fn: (device: NocksterDevice, transport: NocksterTransportMode) => Promise<T>,
  preferredTransport: NocksterTransportPreference = 'auto'
): Promise<T> {
  if (!NocksterDevice.isSupported()) {
    throw new Error('Nockster requires WebHID or Web Serial support');
  }

  const { device, transport } = await connectNocksterDevice(preferredTransport);
  try {
    return await fn(device, transport);
  } finally {
    if (device.isConnected()) {
      await device.disconnect();
    }
  }
}

export async function pairNocksterAccount(
  preferredTransport: NocksterTransportMode = 'hid',
  pin?: string
): Promise<PairedNocksterAccount> {
  const [account] = await listNocksterAccounts(preferredTransport, pin);
  if (!account) {
    throw new Error('Nockster did not report any public keys');
  }
  return account;
}

function assertNocksterInfo(
  info: Awaited<ReturnType<NocksterDevice['getInfo']>>
): NocksterInfoResponse {
  if (info.type === 'Err') {
    throw new Error('Nockster returned an error while reading device info');
  }
  if (info.type !== 'Info') {
    throw new Error(`Unexpected Nockster response: ${info.type}`);
  }
  if (!info.has_seed) {
    throw new Error('Nockster has no seed configured');
  }
  return info;
}

async function buildPairedNocksterAccounts(
  info: NocksterInfoResponse,
  transport: NocksterTransportMode
): Promise<PairedNocksterAccount[]> {
  if (!info.cheetah_pubs.length) {
    throw new Error('Nockster did not report any public keys');
  }

  await initWasmModules();
  return info.cheetah_pubs.map(pub => {
    const publicKeyBytes = serializeCheetahPublicKey(pub.x, pub.y);
    return {
      address: wasm.hashPublicKey(publicKeyBytes),
      slot: pub.slot,
      path: pub.path,
      publicKeyHex: bytesToHex(publicKeyBytes),
      publicKeyBase58: formatCheetahPubkey(pub.x, pub.y),
      transport,
      firmware: `${info.fw_major}.${info.fw_minor}`,
    };
  });
}

export async function listNocksterAccounts(
  preferredTransport: NocksterTransportMode = 'hid',
  pin?: string
): Promise<PairedNocksterAccount[]> {
  return withNocksterDevice(async (device, transport) => {
    await ensureNocksterUnlocked(device, pin);
    return buildPairedNocksterAccounts(assertNocksterInfo(await device.getInfo()), transport);
  }, preferredTransport);
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

function normalizeNocksterTransport(value: unknown): NocksterTransportMode | undefined {
  return value === 'hid' || value === 'serial' ? value : undefined;
}

export function getCurrentNocksterAccount(wallet: WalletLike): NocksterAccountRef | null {
  const current = wallet.currentAccount;
  if (!current) return null;

  const seed =
    wallet.seedSources.find(s => s.accounts.some(a => a.address === current.address)) ??
    wallet.seedSources.find(s => s.id === wallet.activeSeedSourceId);
  const external = seed?.external;
  if (!external) return null;

  const fallback = parseNocksterSourceRef(external.sourceRef);
  const hasNocksterRef =
    typeof fallback.slot === 'number' &&
    Array.isArray(fallback.path) &&
    typeof fallback.publicKeyHex === 'string';
  if (external.provider !== 'nockster' && !hasNocksterRef) return null;

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
    transport: normalizeNocksterTransport(fallback.transport),
  };
}

export async function signRawTxWithNockster(
  rawTx: unknown,
  account: NocksterAccountRef
): Promise<wasm.NockchainTx> {
  assertNativeRawTx(rawTx);
  if (!guard.isRawTxV1(rawTx)) {
    throw new Error('Only v1 raw transactions are supported');
  }

  return withNocksterDevice(async device => {
    await initWasmModules();
    await device.selectSeed(account.slot);
    const draft = wasm.jam(wasm.rawTxToNoun(rawTx));
    const signedDraft = await device.signDraft(draft, NOCKSTER_SIGN_TIMEOUT_MS);
    const signedRawTx = wasm.rawTxFromNoun(wasm.cue(signedDraft));
    if (!guard.isRawTxV1(signedRawTx)) {
      throw new Error('Nockster returned a non-v1 transaction');
    }
    return wasm.rawTxV1ToNockchainTx(signedRawTx);
  }, account.transport ?? 'auto');
}

export async function signMessageWithNockster(
  message: string,
  account: NocksterAccountRef
): Promise<SignMessageResponse> {
  const encoded = new TextEncoder().encode(message);

  return withNocksterDevice(async device => {
    await initWasmModules();
    const publicKeyBytes = hexToBytes(account.publicKeyHex);
    const publicKey = wasm.publicKeyFromBeBytes(publicKeyBytes);
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
  }, account.transport ?? 'auto');
}
