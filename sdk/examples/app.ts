import { signRawTx } from '../dist/wrapper';
import initWasm from '../lib/nbx-wasm/nbx_wasm';
import * as wasm from '../lib/nbx-wasm/nbx_wasm';
import { WasmNote } from '../lib/nbx-wasm/nbx_wasm';

declare global {
    interface Window {
        nockchain?: any;
    }
}


const statusDiv = document.getElementById('status')!;
const outputPre = document.getElementById('output')!;
const connectBtn = document.getElementById('connectBtn') as HTMLButtonElement;
const getInfoBtn = document.getElementById('getInfoBtn') as HTMLButtonElement;
const signRawTxBtn = document.getElementById('signRawTxBtn') as HTMLButtonElement;
const recipientInput = document.getElementById('recipientInput') as HTMLInputElement;

let account: string | null = null;
let grpcEndpoint: string | null = null;
let walletPkh: string | null = null;

function log(msg: string) {
    outputPre.textContent += msg + '\n';
    console.log(msg);
}

async function init() {
    try {
        await initWasm();
        log('WASM initialized');
    } catch (e) {
        log('Failed to init WASM: ' + e);
    }
}

connectBtn.onclick = async () => {
    if (!window.nockchain) {
        log('Nockchain wallet not found');
        return;
    }
    try {
        const accounts = (await window.nockchain.request({ method: 'nock_requestAccounts' })) as string[];
        account = accounts[0];
        statusDiv.textContent = 'Connected: ' + account;
        getInfoBtn.disabled = false;
        signRawTxBtn.disabled = false;
        log('Connected: ' + account);
    } catch (e: any) {
        log('Connect failed: ' + e.message);
    }
};

getInfoBtn.onclick = async () => {
    try {
        const info = (await window.nockchain!.request({ method: 'nock_getWalletInfo' })) as { grpcEndpoint: string; pkh: string };
        grpcEndpoint = info.grpcEndpoint;
        walletPkh = info.pkh;
        log('Wallet Info: ' + JSON.stringify(info, null, 2));
    } catch (e: any) {
        log('Get Info failed: ' + e.message);
    }
};

signRawTxBtn.onclick = async () => {
    try {
        log('Building transaction...');

        // 1. Validate inputs
        if (!account || !grpcEndpoint || !walletPkh) {
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
        const pkh = wasm.WasmPkh.single(walletPkh);
        const spendCondition = wasm.WasmSpendCondition.newPkh(pkh);

        // 4. Get firstName from spend condition
        const firstName = spendCondition.firstName();
        log('First name: ' + firstName.value.substring(0, 20) + '...');

        // 5. Query notes matching this firstName
        log('Querying notes from gRPC...');
        const balance = await grpcClient.get_balance_by_first_name(firstName.value);

        if (!balance || !balance.notes || balance.notes.length === 0) {
            log('No notes found - wallet might be empty');
            return;
        }

        log('Found ' + balance.notes.length + ' notes');

        // Convert notes from protobuf
        const notes = balance.notes.map((n: any) => wasm.WasmNote.fromProtobuf(n.note));
        const note = notes[0];
        const noteAssets = note.assets;
        log('Using note with ' + noteAssets + ' nicks');

        // 6. Build transaction (send 10 NOCK = 655360 nicks)
        const TEN_NOCK_IN_NICKS = BigInt(10 * 65536);
        const feePerWord = BigInt(32768); // 0.5 NOCK per word

        log('Building transaction to send 10 NOCK...');
        const builder = new wasm.WasmTxBuilder(feePerWord);

        // Create recipient digest
        const recipientDigest = new wasm.WasmDigest(recipient);

        // Create refund digest (same as wallet PKH)
        const refundDigest = new wasm.WasmDigest(walletPkh);

        // Create spend conditions - one for each note (all use the same PKH)
        const spendConditionsForBuilder = notes.map(() => spendCondition);

        console.log("spendConditionsForBuilder: ", spendConditionsForBuilder);
        console.log("notes: ", notes);

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

        const rawTxJam = rawTx.toJam();
        log('Jammed tx size: ' + rawTxJam.length + ' bytes');

        // Get notes and spend conditions from builder
        const txNotes = builder.allNotes();
        const txNotesArray = txNotes.get_notes;

        // Convert WasmNote objects to plain JS objects with their attributes
        const noteObjects = txNotesArray.map((n: WasmNote) => ({
            version: 1,
            originPage: n.originPage.toString(),
            name: {
                first: n.name.first,
                last: n.name.last
            },
            noteData: {
                entries: n.noteData.entries.map(e => ({
                    key: e.key,
                    blob: Array.from(e.blob).map(b => b.toString(16).padStart(2, '0')).join('')
                }))
            },
            assets: n.assets.toString()
        }));

        const txSpendConditions = txNotes.spendConditions;

        // Create one spend condition per note (all PKH-bound to wallet)
        const spendConds = txSpendConditions.map(() => ({ type: 'pkh', value: walletPkh }));

        log('Notes count: ' + noteObjects.length);
        log('Spend conditions count: ' + spendConds.length);

        // 8. Sign using signRawTx
        log('Signing transaction...');
        const signedTxHex = await signRawTx({
            rawTx: rawTxJam,
            notes: noteObjects,
            spendConditions: spendConds
        });

        log('Transaction signed successfully!');
        log('Signed tx (hex): ' + signedTxHex.substring(0, 100) + '...');

        // 9. Download to file using transaction ID
        const blob = new Blob([signedTxHex], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `tx_${txId.value.substring(0, 16)}.hex`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        log('Downloaded transaction to file: tx_' + txId.value.substring(0, 16) + '.hex');

    } catch (e: any) {
        log('Error: ' + e.message);
        console.error(e);
    }
};

init();
