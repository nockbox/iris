import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import initWasm, * as wasm from '@nockbox/iris-wasm';

const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

beforeAll(async () => {
  const require = createRequire(import.meta.url);
  const packageEntry = require.resolve('@nockbox/iris-wasm');
  const wasmBytes = await readFile(join(dirname(packageEntry), 'iris_wasm_bg.wasm'));

  // Load the exact binary shipped by the installed package. This avoids the mocked
  // WASM facade used by unit tests and exercises the real serialization boundary.
  await initWasm({ module_or_path: wasmBytes });
});

describe('native V1 transaction intent across the WASM signing boundary', () => {
  it('preserves intent and inputs while producing a signed protobuf transaction', async () => {
    const masterKey = wasm.deriveMasterKeyFromMnemonic(MNEMONIC, '');
    const privateKeyBytes = masterKey.privateKey;
    if (!privateKeyBytes) {
      masterKey.free();
      throw new Error('deterministic mnemonic did not derive a private key');
    }

    const privateKey = wasm.PrivateKey.fromBytes(new Uint8Array(privateKeyBytes));
    const unsignedBuilder = new wasm.TxBuilder(wasm.txEngineSettingsV1Default());
    let signingBuilder;

    try {
      const ownerPkh = wasm.hashPublicKey(masterKey.publicKey);
      const spendCondition = wasm.spendConditionNewPkh(wasm.pkhSingle(ownerPkh));
      const note = {
        version: 1,
        origin_page: 42,
        name: {
          first: wasm.spendConditionFirstName(spendCondition),
          last: wasm.hashU64(7n),
          _sig: 0,
        },
        note_data: [],
        assets: '1000000000',
      };

      unsignedBuilder.simpleSpend(
        [note],
        [{ lock: spendCondition, lock_sp_index: 0 }],
        wasm.hashU64(101n),
        '1000000',
        null,
        ownerPkh,
        false
      );

      const unsignedTx = unsignedBuilder.build();
      const unsignedRaw = wasm.nockchainTxToRawTx(unsignedTx);
      const unsignedIntentHash = wasm.spendsV1Hash(unsignedTx.spends);
      const unsignedFee = wasm.rawTxTotalFees(unsignedRaw);
      const unsignedInputs = wasm.rawTxInputNames(unsignedRaw);
      const clonedBuild = structuredClone({ tx: unsignedTx, notes: [note] });
      const jsonBuild = JSON.parse(JSON.stringify({ tx: unsignedTx, notes: [note] }));

      expect(unsignedInputs).toEqual([note.name]);
      expect(wasm.nockchainTxToRawTx(clonedBuild.tx).id).toBe(unsignedRaw.id);
      expect(clonedBuild.notes[0]).toEqual(note);
      expect(wasm.nockchainTxToRawTx(jsonBuild.tx).id).toBe(unsignedRaw.id);
      expect(jsonBuild.notes[0]).toEqual(note);

      signingBuilder = wasm.TxBuilder.fromRawTx(unsignedRaw, wasm.txEngineSettingsV1Default());
      await signingBuilder.sign(privateKey);
      signingBuilder.validate();

      const signedTx = signingBuilder.build();
      const signedRaw = wasm.nockchainTxToRawTx(signedTx);
      const signedProtobuf = wasm.rawTxToProtobuf(signedRaw);

      expect(wasm.spendsV1Hash(signedTx.spends)).toBe(unsignedIntentHash);
      expect(wasm.rawTxTotalFees(signedRaw)).toBe(unsignedFee);
      expect(wasm.rawTxInputNames(signedRaw)).toEqual(unsignedInputs);
      expect(wasm.rawTxInputNames(signedRaw)).toHaveLength(1);

      expect(signedRaw.id).toBe(signedTx.id);
      expect(signedProtobuf.id).toBe(signedRaw.id);
      expect(signedRaw.id).not.toBe(unsignedRaw.id);
      expect(signedProtobuf.spends).toHaveLength(signedRaw.spends.length);
    } finally {
      signingBuilder?.free();
      unsignedBuilder.free();
      privateKey.free();
      masterKey.free();
    }
  });
});
