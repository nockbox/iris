# WASM Modules

This directory contains WebAssembly modules used by the wallet extension.

## Modules

### nbx-wasm

**Source**: `github.com/nockbox/wallet`
**Purpose**: Transaction building, gRPC client, address derivation, first-name derivation

### nbx-crypto (External Module)

**Source**: External `nockchain-tx` repo
**Purpose**: Message signing only (`signDigest`, `tip5Hash`)
**Note**: WASM file is committed to repo - no build needed

## Building & Updating

**Only nbx-wasm needs to be built.** The nbx-crypto module is external and already included in the repo.

### Prerequisites

```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Install wasm-pack
cargo install wasm-pack
```

### Update nbx-wasm

```bash
# Clone/update wallet repo (if needed)
git clone https://github.com/nockbox/wallet.git
# or: cd wallet && git pull

# Build from wallet repo
cd wallet/crates/nbx-wasm
wasm-pack build --target web --out-dir ../../pkg

# Copy to fort-nock (adjust path as needed)
rsync -av --delete ../../pkg/ /path/to/fort-nock/extension/lib/nbx-wasm/

# Rebuild extension
npm run build
```

## What Uses What

- **Transactions**: nbx-wasm (TxBuilder, GrpcClient)
- **Balance Queries**: nbx-wasm (GrpcClient, SpendCondition.firstName)
- **Address Derivation**: nbx-wasm (hashPublicKey)
- **Message Signing**: nbx-crypto (tip5Hash, signDigest)

**Initialization:**
- nbx-crypto and nbx-wasm: `extension/shared/wasm-utils.ts`
- First-name derivation: `extension/shared/first-name-derivation.ts`
