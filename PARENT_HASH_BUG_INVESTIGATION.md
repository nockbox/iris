# Parent Hash Bug Investigation

## Problem Statement

Nockchain wallet transactions are being rejected by the mempool with the error:
```
Transaction rejected: parent_hash mismatch
```

**Expected Behavior:** Output seeds should have `parent_hash` equal to the transaction ID being created

**Actual Behavior:** Output seeds have `parent_hash` equal to the input note's hash instead

## Architecture Overview

### Transaction Flow
```
TypeScript (transaction-builder.ts)
    ↓
WASM Boundary (nbx-wasm/tx.rs)
    ↓
TxBuilder (nbx-nockchain-types/builder.rs)
    ↓ sign()
RawTx (nbx-nockchain-types/tx.rs)
    ↓ From<RawTx>
Protobuf (nbx-grpc-proto/convert.rs)
    ↓ serde
JSON (sent to blockchain)
```

### Initial Design Issue

The original implementation had seeds initialized with `parent_hash = note.hash()` in `builder.rs`:

```rust
// Line 45 and 48 in builder.rs
seeds_vec.push(Seed::new_single_pkh(refund_pkh, refund, note.hash(), include_lock_data));
seeds_vec.push(Seed::new_single_pkh(recipient, gift_portion, note.hash(), include_lock_data));
```

This was supposed to be overwritten in `sign()` to use `tx_id`.

## Investigation Timeline

### Phase 1: Initial Fix Attempt (Nov 18, 12:57)

**Changes Made:**
1. Modified `tx.rs` to add wrapper types (`SeedNoParentHash`, etc.) that compute tx ID without including parent_hash
2. Modified `builder.rs sign()` to set `seed.parent_hash = tx_id` after computing ID
3. Added canary test `wasmBuildId()` to verify correct WASM is loaded

**Files Modified:**
- `/Users/shawntobin/Documents/GitHub/wallet/crates/nbx-nockchain-types/src/tx_engine/tx.rs`
- `/Users/shawntobin/Documents/GitHub/wallet/crates/nbx-nockchain-types/src/tx_engine/builder.rs`
- `/Users/shawntobin/Documents/GitHub/wallet/crates/nbx-wasm/src/tx.rs`

**Result:** ❌ Transaction still had wrong parent_hash, but canary confirmed new WASM was loaded

### Phase 2: Assertion Discovery (Nov 18, 13:28)

**Added Assertions in builder.rs:**
```rust
pub fn sign(mut self, signing_key: &PrivateKey) -> Result<RawTx, BuildError> {
    let tx_id = RawTx::compute_id(Version::V1, &self.spends);

    for (_, spend) in self.spends.0.iter_mut() {
        for seed in spend.seeds.0.iter_mut() {
            seed.parent_hash = tx_id;
            assert_eq!(seed.parent_hash, tx_id, "CANARY FAIL: parent_hash not set to tx_id");
        }
    }
    // ... signing ...
    Ok(RawTx::new(self.spends))
}
```

**Test Result:**
- ✅ Canary appeared: `nbx-wasm 0.1.0 - PARENT_HASH_FIX_V2`
- ✅ No panic occurred (assertion passed!)
- ❌ JSON still showed wrong parent_hash

**Example Transaction:**
```json
{
  "id": "Ctise3nakH8QSeF99q43eLpVEuUzwBqTrDH68t8KYEKAoFyYfdeR9PC",
  "spends": [{
    "seed": {
      "parent_hash": "8wc9YyRSahWjX38ZDSdDUE3U5wKkiX6LPYttjNUVRg3UJtbc14tbfeH"  // WRONG!
    }
  }]
}
```

**Critical Discovery:** The assertion proves the Rust code IS setting parent_hash correctly, but something between Rust and JSON is changing it back.

### Phase 3: Enhanced Assertions (Nov 18, 13:28)

**Added More Detailed Checks:**
```rust
pub fn sign(mut self, signing_key: &PrivateKey) -> Result<RawTx, BuildError> {
    let tx_id = RawTx::compute_id(Version::V1, &self.spends);

    for (_, spend) in self.spends.0.iter_mut() {
        for seed in spend.seeds.0.iter_mut() {
            let old_parent_hash = seed.parent_hash;
            seed.parent_hash = tx_id;

            assert_eq!(seed.parent_hash, tx_id, "CANARY: not set to tx_id");
            assert_ne!(seed.parent_hash, old_parent_hash, "CANARY: didn't change from old value");
        }
    }

    // Sign...

    // Verify still correct after signing
    for (_, spend) in self.spends.0.iter() {
        for seed in spend.seeds.0.iter() {
            assert_eq!(seed.parent_hash, tx_id, "CANARY: changed during signing!");
        }
    }

    Ok(RawTx::new(self.spends))
}
```

**Result:** ✅ All assertions passed, no panic

### Phase 4: Logging at Protobuf Boundary (Nov 18, 15:59)

**Added Logging in tx.rs toProtobuf():**
```rust
pub fn to_protobuf(&self) -> Result<JsValue, JsValue> {
    web_sys::console::log_1(&format!(
        "[CANARY toProtobuf] tx.id = {}",
        self.internal.id
    ).into());

    for (i, (_, spend)) in self.internal.spends.0.iter().enumerate() {
        for (j, seed) in spend.seeds.0.iter().enumerate() {
            web_sys::console::log_1(&format!(
                "[CANARY toProtobuf] BEFORE: spend[{}].seed[{}].parent_hash = {}",
                i, j, seed.parent_hash
            ).into());
        }
    }

    let pb_tx = PbRawTransaction::from(self.internal.clone());
    // ... serialize ...
}
```

**Test Result:**
```
[CANARY toProtobuf] tx.id = DLSQFgeYMcke4QUr8t4vCkUWSKVcMAb63oBkXe9Dyeuo9NvE854yMh3
[CANARY toProtobuf] BEFORE: spend[0].seed[0].parent_hash = AQAtYyqHszsJN8gmcW1fvHnyufnAXNjFrgDnAuAsABgPsFQhPQKB83u
[CANARY toProtobuf] BEFORE: spend[0].seed[1].parent_hash = AQAtYyqHszsJN8gmcW1fvHnyufnAXNjFrgDnAuAsABgPsFQhPQKB83u
```

**SMOKING GUN:** 🔥
- Transaction ID: `DLSQFgeYMcke4QUr8t4vCkUWSKVcMAb63oBkXe9Dyeuo9NvE854yMh3`
- parent_hash values: `AQAtYyqHszsJN8gmcW1fvHnyufnAXNjFrgDnAuAsABgPsFQhPQKB83u` ❌

This proves parent_hash is WRONG by the time we reach `toProtobuf()`, despite all assertions passing in `builder.rs sign()`.

### Phase 5: Narrowing the Bug Location (Current)

**Bug Window Identified:**
The corruption happens between:
- ✅ `builder.rs line 97` - assertions pass, parent_hash is correct
- ✅ `builder.rs line 100` - `RawTx::new(self.spends)` called
- ❌ `tx.rs line 772` - wrong parent_hash observed

**Added Assertions in Critical Path:**

1. **RawTx::new() (tx.rs line 283-290):**
```rust
pub fn new(spends: Spends) -> Self {
    let version = Version::V1;
    let id = Self::compute_id(version.clone(), &spends);

    // CANARY: Verify spends still have correct parent_hash
    for (_, spend) in spends.0.iter() {
        for seed in spend.seeds.0.iter() {
            assert_eq!(
                seed.parent_hash, id,
                "CANARY RawTx::new() FAIL: seed.parent_hash = {}, expected id = {}",
                seed.parent_hash, id
            );
        }
    }

    Self { version, id, spends }
}
```

2. **WasmRawTx::from_internal() (tx.rs line 756-777):**
```rust
fn from_internal(tx: &RawTx) -> Self {
    // Verify BEFORE clone
    for (i, (_, spend)) in tx.spends.0.iter().enumerate() {
        for (j, seed) in spend.seeds.0.iter().enumerate() {
            assert_eq!(
                seed.parent_hash, tx.id,
                "CANARY from_internal() BEFORE clone: spend[{}].seed[{}].parent_hash = {}, expected tx.id = {}",
                i, j, seed.parent_hash, tx.id
            );
        }
    }

    let cloned = tx.clone();

    // Verify AFTER clone
    for (i, (_, spend)) in cloned.spends.0.iter().enumerate() {
        for (j, seed) in spend.seeds.0.iter().enumerate() {
            assert_eq!(
                seed.parent_hash, cloned.id,
                "CANARY from_internal() AFTER clone: spend[{}].seed[{}].parent_hash = {}, expected tx.id = {}",
                i, j, seed.parent_hash, cloned.id
            );
        }
    }

    Self { internal: cloned }
}
```

## Technical Details

### Key Code Paths

**Seed Creation (builder.rs line 45, 48):**
```rust
seeds_vec.push(Seed::new_single_pkh(refund_pkh, refund, note.hash(), include_lock_data));
seeds_vec.push(Seed::new_single_pkh(recipient, gift_portion, note.hash(), include_lock_data));
```
Initially sets `parent_hash = note.hash()` - this is the wrong value we keep seeing!

**Transaction ID Computation (tx.rs line 274-276):**
```rust
pub fn compute_id(version: Version, spends: &Spends) -> TxId {
    (&version, &SpendsNoParentHash(spends)).hash()
}
```
Uses special wrapper types that exclude parent_hash from the hash computation.

**Parent Hash Fix (builder.rs line 75-82):**
```rust
for (_, spend) in self.spends.0.iter_mut() {
    for seed in spend.seeds.0.iter_mut() {
        seed.parent_hash = tx_id;
        assert_eq!(seed.parent_hash, tx_id, "...");
    }
}
```
This DOES execute successfully (proven by passing assertions).

### Protobuf Serialization

**Seed to Protobuf (convert.rs line 183-192):**
```rust
impl From<Seed> for PbSeed {
    fn from(seed: Seed) -> Self {
        PbSeed {
            output_source: None,
            lock_root: Some(PbHash::from(seed.lock_root)),
            note_data: Some(PbNoteData::from(seed.note_data)),
            gift: Some(PbNicks::from(seed.gift)),
            parent_hash: Some(PbHash::from(seed.parent_hash)),
        }
    }
}
```

**Serde Configuration (build.rs line 38-39):**
```rust
.field_attribute("Seed.parent_hash", "#[serde(with = \"crate::serde_hash_as_base58\")]");
```

## Hypotheses

### ❌ Hypothesis 1: Assignment Doesn't Work
**Status:** DISPROVEN
**Evidence:** Assertions immediately after assignment pass

### ❌ Hypothesis 2: Signing Modifies parent_hash
**Status:** DISPROVEN
**Evidence:** Assertion after signing still passes

### ❌ Hypothesis 3: Browser Caching Old WASM
**Status:** DISPROVEN
**Evidence:** Canary test proves new WASM is loaded

### 🤔 Hypothesis 4: RawTx::new() Recomputes Something
**Status:** TESTING
**Evidence:** Bug happens between builder.rs:100 and tx.rs:772

### 🤔 Hypothesis 5: Clone Corrupts Data
**Status:** TESTING
**Evidence:** Multiple clones happen (RawTx, WasmRawTx from_internal, toProtobuf)

### 🤔 Hypothesis 6: Derive(Clone) Implementation Bug
**Status:** POSSIBLE
**Evidence:** Seed, Spend, Spends, RawTx all use `#[derive(Clone)]`

## Phase 6: The Paradox - Assertions Pass, Logs Fail (Nov 18, 16:15)

**Test Result:** NO PANIC! All assertions passed! 🚨

**Evidence:**
```
[CANARY toProtobuf] tx.id = DLSQFgeYMcke4QUr8t4vCkUWSKVcMAb63oBkXe9Dyeuo9NvE854yMh3
[CANARY toProtobuf] BEFORE: spend[0].seed[0].parent_hash = AQAtYyqHszsJN8gmcW1fvHnyufnAXNjFrgDnAuAsABgPsFQhPQKB83u
[CANARY toProtobuf] BEFORE: spend[0].seed[1].parent_hash = AQAtYyqHszsJN8gmcW1fvHnyufnAXNjFrgDnAuAsABgPsFQhPQKB83u
```

**The Paradox:**
- ✅ All `assert_eq!(seed.parent_hash, tx_id)` pass
- ❌ But logging shows `parent_hash != tx_id`

This means:
1. When Rust **compares** values with `==`, they match
2. When Rust **displays** values with `{}`, they show different data
3. Either PartialEq is broken, or Display is broken, or something very weird is happening

**Possible Explanations:**
1. **Digest::Display broken** - displays different data than what PartialEq uses
2. **Digest::PartialEq broken** - always returns true
3. **Memory corruption** - data changes between comparison and logging
4. **Multiple instances** - different WasmRawTx instances with different data

### Phase 6.1: Display Value Investigation (Nov 18, 16:20)

**New Logging Added in from_internal():**
```rust
web_sys::console::log_1(&format!(
    "[CANARY from_internal] tx.id DISPLAY = {}",
    tx.id
).into());

web_sys::console::log_1(&format!(
    "[CANARY from_internal] BEFORE clone: parent_hash DISPLAY = {}",
    seed.parent_hash
).into());

web_sys::console::log_1(&format!(
    "[CANARY from_internal] Comparison: seed.parent_hash == tx.id? {}",
    seed.parent_hash == tx.id
).into());
```

**This Will Reveal:**
1. What tx.id displays as in from_internal (should match tx_id from builder)
2. What parent_hash displays as before clone (should match tx.id)
3. Whether the comparison actually returns true or false
4. What parent_hash displays as after clone

**Expected Results:**
- If displays match but later change: Something modifies data after from_internal
- If displays don't match but comparison is true: Serious bug in Digest type
- If comparison is false: Assertions should have panicked (impossible!)

## Current Test Setup (Nov 18, 16:20)

**Assertions in Place:**
1. ✅ builder.rs:75-82 - Parent hash set correctly
2. ✅ builder.rs:93-96 - Still correct after signing
3. ✅ tx.rs:283-290 - RawTx::new() received correct data (PASSED)
4. ✅ tx.rs:756-777 - before/after clone in from_internal() (PASSED)
5. 📝 tx.rs:762-778 - Log actual values + comparison in from_internal()
6. 📝 tx.rs:810-820 - Log actual values in toProtobuf()

## Files Modified

### Rust Files
- `/Users/shawntobin/Documents/GitHub/wallet/crates/nbx-nockchain-types/src/tx_engine/tx.rs`
  - Added SeedNoParentHash wrapper types (line 58-90)
  - Modified RawTx::new() with assertion (line 283-290)

- `/Users/shawntobin/Documents/GitHub/wallet/crates/nbx-nockchain-types/src/tx_engine/builder.rs`
  - Modified sign() to set parent_hash (line 68-101)
  - Added multiple assertions

- `/Users/shawntobin/Documents/GitHub/wallet/crates/nbx-wasm/src/tx.rs`
  - Added wasmBuildId() canary (line 21-27)
  - Modified from_internal() with assertions (line 754-782)
  - Added logging to toProtobuf() (line 784-806)

### TypeScript Files
- `/Users/shawntobin/fort-nock/extension/shared/transaction-builder.ts`
  - Added canary logging (line 47)
  - Imported wasmBuildId (line 18)

## Build Commands

```bash
# Clean rebuild
cd /Users/shawntobin/Documents/GitHub/wallet
cargo clean
cd crates/nbx-wasm
wasm-pack build --target web --out-dir ../../pkg

# Copy to extension
cp /Users/shawntobin/Documents/GitHub/wallet/pkg/nbx_wasm* /Users/shawntobin/fort-nock/extension/lib/nbx-wasm/

# Build extension
cd /Users/shawntobin/fort-nock/extension
npm run build

# Extension output
# /Users/shawntobin/fort-nock/extension/dist
```

## Testing Protocol

1. **Remove extension** completely from Chrome
2. **Clear cache**: Cmd+Shift+Delete → Clear all cached images and files
3. **Close Chrome**: Cmd+Q (complete quit)
4. **Reopen Chrome**
5. **Load extension** from `/Users/shawntobin/fort-nock/extension/dist`
6. **Send transaction**
7. **Check console** for:
   - Canary message: `[TxBuilder] 🐤 WASM build: nbx-wasm 0.1.0 - PARENT_HASH_FIX_V2`
   - Any panic messages
   - Log messages: `[CANARY toProtobuf] tx.id = ...`

## Next Steps

1. **Test with current assertions** - determine exact panic location
2. **If RawTx::new() panics**: Data corruption in move from builder
3. **If from_internal() panics**: Clone implementation issue
4. **If no panic**: Investigate why assertions pass but data is wrong

## References

- GPT-5 Pro Analysis: Suggested circular dependency issue with parent_hash in hash computation
- Canary Test Pattern: Used to verify WASM loading
- Assertion-Based Debugging: Narrowing bug location through systematic checks
