import { NockchainProvider, wasm } from '../src/index';

const statusDiv = document.getElementById('status')!;
const outputPre = document.getElementById('output')!;
const connectBtn = document.getElementById('connectBtn') as HTMLButtonElement;
const signRawTxBtn = document.getElementById('signRawTxBtn') as HTMLButtonElement;
const recipientInput = document.getElementById('recipientInput') as HTMLInputElement;

let provider: NockchainProvider;
let grpcEndpoint: string | null = null;
let walletPkh: string | null = null;

function log(msg: string) {
  outputPre.textContent += msg + '\n';
  console.log(msg);
}

async function init() {
  try {
    await wasm.default();
    log('WASM initialized');

    // Initialize NockchainProvider
    provider = new NockchainProvider();
    log('NockchainProvider initialized');
  } catch (e) {
    log('Failed to init: ' + e);
  }
}

connectBtn.onclick = async () => {
  if (!provider) {
    log('Provider not initialized');
    return;
  }
  try {
    // Connect to wallet (returns pkh and grpcEndpoint)
    const info = await provider.connect();
    grpcEndpoint = info.grpcEndpoint;
    walletPkh = info.pkh;

    statusDiv.textContent = 'Connected: ' + walletPkh;
    signRawTxBtn.disabled = false;
    log('Connected: ' + walletPkh + ' @ ' + grpcEndpoint);
  } catch (e: any) {
    log('Connect failed: ' + e.message);
  }
};

signRawTxBtn.onclick = async () => {
  try {
    log('Building transaction...');

    // 1. Validate inputs
    if (!grpcEndpoint || !walletPkh) {
      log('Please connect and get wallet info first');
      return;
    }

    const recipient = recipientInput.value.trim();
    if (!recipient) {
      log('Please enter a recipient address');
      return;
    }

    // 2. Create gRPC client
    log('Creating gRPC client for: ' + grpcEndpoint);
    const grpcClient = new wasm.GrpcClient(grpcEndpoint);

    // 3. Create spend condition using wallet PKH (single, no timelock)
    log('Creating spend condition for PKH: ' + walletPkh);
    const pkh = wasm.Pkh.single(walletPkh);
    const spendCondition = wasm.SpendCondition.newPkh(pkh);

    // 4. Get firstName from spend condition
    const firstName = spendCondition.firstName();
    log('First name: ' + firstName.value.substring(0, 20) + '...');

    // 5. Query notes matching this firstName
    log('Querying notes from gRPC...');
    const balance = await grpcClient.getBalanceByFirstName(firstName.value);

    if (!balance || !balance.notes || balance.notes.length === 0) {
      log('No notes found - wallet might be empty');
      return;
    }

    log('Found ' + balance.notes.length + ' notes');

    // Convert notes from protobuf
    const notes = balance.notes.map((n: any) => wasm.Note.fromProtobuf(n.note));
    const note = notes[0];
    const noteAssets = note.assets;
    log('Using note with ' + noteAssets + ' nicks');

    // 6. Build transaction (send 10 NOCK = 655360 nicks)
    const TEN_NOCK_IN_NICKS = BigInt(10 * 65536);
    const feePerWord = BigInt(32768); // 0.5 NOCK per word

    log('Building transaction to send 10 NOCK...');
    const builder = new wasm.TxBuilder(feePerWord);

    // Create recipient digest
    const recipientDigest = new wasm.Digest(recipient);

    // Create refund digest (same as wallet PKH)
    const refundDigest = new wasm.Digest(walletPkh);

    // Use simpleSpend (no lockData for lower fees)
    builder.simpleSpend(
      [notes[0]],
      [spendCondition],
      recipientDigest,
      TEN_NOCK_IN_NICKS,
      null, // fee_override (let it auto-calculate)
      refundDigest,
      false // include_lock_data
    );

    // 7. Build the transaction and get notes/spend conditions
    log('Building raw transaction...');
    const rawTx = builder.build();
    const txId = rawTx.id;
    log('Transaction ID: ' + txId.value);

    const rawTxProtobuf = rawTx.toRawTx().toProtobuf();

    // Get notes and spend conditions from builder
    const txNotes = builder.allNotes();

    log('Notes count: ' + txNotes.notes.length);
    log('Spend conditions count: ' + txNotes.spendConditions.length);

    // 8. Sign using provider.signRawTx (pass wasm objects directly)
    log('Signing transaction...');
    const signedTxProtobuf = await provider.signRawTx({
      rawTx: rawTx, // Pass wasm RawTx directly
      notes: txNotes.notes, // Pass wasm Note objects directly
      spendConditions: txNotes.spendConditions, // Pass wasm SpendCondition objects directly
    });

    log('Transaction signed successfully!');

    // Convert to jam string for file download
    const signedTx = wasm.RawTx.fromProtobuf(signedTxProtobuf);
    const jamBytes = signedTx.toJam();

    // 9. Download to file using transaction ID
    const blob = new Blob([new Uint8Array(jamBytes)], { type: 'application/jam' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${txId.value}.tx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    log('Downloaded transaction to file: ' + txId.value + '.tx');
  } catch (e: any) {
    log('Error: ' + e.message);
    console.error(e);
  }
};

init();
