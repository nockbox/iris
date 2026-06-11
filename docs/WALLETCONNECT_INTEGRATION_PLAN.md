# WalletConnect Integration Plan for Iris

**Status:** Proposal / planning document
**Scope:** `nockbox/iris` (extension), `nockbox/iris-sdk` (dapp SDK), mobile Iris app (separate repo), `nockbox/iris-rs` (no changes expected)
**Last updated:** 2026-06-11

---

## 1. Goal and motivation

Today, dapps connect to Iris exclusively through the **injected provider**: the
extension injects `window.nockchain` (`extension/inpage/index.ts`) into every
page, and `@nockbox/iris-sdk`'s `NockchainProvider` talks to it via
`window.postMessage`. This only works when the wallet is a browser extension
running *in the same browser* as the dapp.

With a **mobile Iris app** in development, we need a way for:

- a dapp in a **desktop browser** to connect to Iris running on a **phone**
  (QR-code pairing);
- a dapp in a **mobile browser** to connect to the Iris app on the same phone
  (deep-link pairing);
- desktop dapps / native apps that aren't browser pages at all.

**WalletConnect v2** (the protocol; tooling is now branded **Reown**) is the
industry standard for exactly this: an end-to-end-encrypted message relay
between a dapp and a wallet, with a session/permission model that is
**chain-agnostic** via CAIP namespaces. Nockchain is not an EVM chain, which is
fine — WalletConnect supports arbitrary namespaces (Solana, Cosmos, Tezos, etc.
all ship custom namespaces) — but it means we define the Nockchain namespace
convention ourselves.

### Non-goals

- Replacing the injected provider. Same-browser extension flows stay as they
  are; WalletConnect is an *additional transport*.
- WalletConnect v1 (sunset), or non-Reown relays (self-hosting a relay is
  possible later; not in scope).

---

## 2. WalletConnect v2 primer (as it applies to us)

Key concepts and how they map onto what Iris already has:

| WalletConnect concept | What it is | Iris equivalent today |
|---|---|---|
| **Pairing** | One-time key exchange bootstrapped by a `wc:` URI (QR code / deep link) | n/a (content-script injection) |
| **Session proposal** | Dapp requests access to chains/methods/events/accounts | `nock_connect` → `ConnectApprovalScreen` |
| **Session** | Long-lived permission grant, symmetric-key encrypted topic on the relay | `approvedOrigins` set in `background/index.ts` |
| **Session request** | JSON-RPC call inside a session (`wc_sessionRequest`) | provider method dispatch in `chrome.runtime.onMessage` handler |
| **Relay** | Reown-hosted websocket message broker (`wss://relay.walletconnect.com`) | n/a |
| **Verify API** | Reown attestation that the proposal really came from the claimed origin | `sender.origin` check, `isOriginApproved()` |

The wallet side integrates **`@reown/walletkit`** (formerly
`@walletconnect/web3wallet`); the dapp side integrates
**`@walletconnect/universal-provider`** or raw `@walletconnect/sign-client`
(Reown's AppKit modal has limited support for fully custom namespaces, so we
wrap sign-client ourselves in the SDK — see §5).

Both sides need a free **Reown Cloud project ID** (one per app:
`iris-extension`, `iris-mobile`, and a demo dapp).

---

## 3. The Nockchain CAIP namespace (design decision, do first)

Everything else hangs off this. We must specify and document:

### 3.1 CAIP-2 chain ID

Format is `namespace:reference`. Proposal:

```
nockchain:mainnet          # or nockchain:<first-8-bytes-of-genesis-hash>
```

Genesis-hash-based references are the CAIP-recommended practice (cf.
`bip122:000000000019d6689c085ae165831e93` for Bitcoin) and disambiguate
testnets/forks for free. If we expect testnets, prefer the hash form from day
one; renaming a namespace later breaks every live session. **Open question
O-1** (§10).

### 3.2 CAIP-10 account ID

```
nockchain:mainnet:<pkh>
```

where `<pkh>` is the canonical string encoding of the public key hash that
`nock_connect` returns today (`buildConnectResponse()` in
`extension/background/index.ts`).

### 3.3 Session methods

The session's `methods` array is exactly our existing RPC surface from
`iris-sdk/src/constants.ts` (`PROVIDER_METHODS`), minus `nock_connect` — in
WalletConnect, *connecting is the session approval itself*:

```
nock_signMessage
nock_signTx
nock_sendTransaction
nock_getWalletInfo
nock_estimateTransactionFee
```

`nock_signRawTx` is legacy v0 API; do **not** expose it over WalletConnect.
The existing API-version bridging (`bridgeIncomingProviderPayload()` /
`mapRpcRequest()`) applies only to the injected path; WalletConnect requests
are always current-version (`RPC_API_VERSION`).

### 3.4 Session events

```
nock_accountsChanged      # active account switched in the wallet
nock_chainChanged         # reserved; emit if/when testnet support lands
```

### 3.5 Deliverable

A short spec, `docs/nockchain-caip-namespace.md`, committed to this repo and
mirrored into `iris-sdk` (it's the contract both sides compile against —
export the constants from the SDK so there is one source of truth:
`NOCKCHAIN_NAMESPACE`, `NOCKCHAIN_CHAINS`, `NOCKCHAIN_WC_METHODS`,
`NOCKCHAIN_WC_EVENTS`).

---

## 4. Wallet side: `nockbox/iris` extension

This is the biggest chunk of work. Target architecture:

```
                                ┌─────────────────────────────────────────┐
                                │ background service worker               │
 dapp (injected) ──postMessage──► chrome.runtime.onMessage                │
                                │      │                                  │
                                │      ▼                                  │
                                │  requestRouter() ◄── walletconnect/     │
                                │      │                service.ts        │
                                │      ▼                    ▲             │
                                │  pendingRequests map      │ relay msgs  │
                                │  createApprovalPopup()    │             │
                                └───────────────────────────┼─────────────┘
                                                            │
                                              ┌─────────────┴────────────┐
                                              │ offscreen document       │
                                              │ (persistent WebSocket    │
                                              │  to Reown relay)         │
                                              └──────────────────────────┘
```

### 4.1 New module layout

```
extension/walletconnect/
  service.ts          # WalletKit init, event wiring, session store
  storage-adapter.ts  # chrome.storage.local adapter for WalletKit
  request-mapper.ts   # wc session_request <-> internal pendingRequests entry
  namespace.ts        # re-export namespace constants from @nockbox/iris-sdk
extension/offscreen/
  index.html
  index.ts            # hosts the relay WebSocket (see 4.3)
```

### 4.2 Refactor prerequisite: extract a transport-agnostic request router

Today `extension/background/index.ts` (~2,150 lines) couples three things in
the `chrome.runtime.onMessage` listener: message transport, origin/approval
checks, and per-method handling (`pendingRequests.set(...)` +
`createApprovalPopup(...)` per method, around lines 796–1020).

Extract the per-method core into:

```ts
// extension/background/request-router.ts
export type RequestSource =
  | { kind: 'injected'; origin: string }
  | { kind: 'walletconnect'; topic: string; peerMeta: SessionPeerMetadata; verifyContext: VerifyContext };

export async function routeProviderRequest(
  source: RequestSource,
  request: RpcRequest
): Promise<RpcResponse>;
```

The injected path keeps its exact behavior (`isOriginApproved`,
`approvedOrigins`, API-version bridging). The WalletConnect path substitutes
the *session* for origin approval (an active WC session **is** the approval —
no second `nock_connect` round-trip) and skips legacy bridging. Everything
downstream — `pendingRequests`, `createApprovalPopup()`, the
`GET_PENDING_*` / `APPROVE_*` / `REJECT_*` message constants in
`extension/shared/constants.ts`, and the approval screens routed in
`extension/popup/Router.tsx` — is reused unchanged, except the approval
screens learn to render WC peer metadata (§4.6).

This refactor is independently valuable and should land as its own PR before
any WalletConnect code.

### 4.3 MV3 service worker lifetime — the hard part

WalletKit holds a persistent WebSocket to the relay. Chrome kills MV3 service
workers after ~30s of inactivity; a killed worker means missed session
requests until the next wake.

**Chosen approach: offscreen document** (`chrome.offscreen` API, Chrome 109+):

- Background SW creates an offscreen document with reason `WORKERS`
  justification "maintain WalletConnect relay connection".
- The offscreen page owns the `Core`/relayer WebSocket and forwards
  `session_proposal` / `session_request` / `session_delete` events to the SW
  via `chrome.runtime.sendMessage`; SW replies (approve/reject/respond) flow
  back the same way.
- Offscreen documents are not subject to the 30s SW timeout. The SW itself can
  sleep; incoming relay traffic wakes it via the message.
- Manifest changes: add `"offscreen"` to `permissions` (currently
  `["storage", "alarms"]` in `extension/manifest.json`).

**Fallbacks / pragmatics:**

- Phase-1 spike can run WalletKit directly in the SW with a
  `chrome.alarms`-based keepalive (alarm every 25s pings the relay). Simpler,
  good enough to validate the flow end-to-end, but battery/CPU hostile and
  fragile — do not ship it. The `alarms` permission is already present.
- WalletKit must be initialized lazily and idempotently on every SW wake
  (session store rehydrated from storage — see 4.4); never assume in-memory
  state survives.
- Connection policy: only hold the relay socket open while ≥1 active WC
  session exists (or a pairing is in progress). No sessions → no socket → no
  offscreen document. This keeps the extension inert for users who never use
  WalletConnect.

### 4.4 Storage adapter

WalletKit persists pairings/sessions/keychain via a pluggable `storage`
option (`IKeyValueStorage`: `getItem`/`setItem`/`removeItem`/`getKeys`/
`getEntries`). Service workers have no `localStorage`; implement
`extension/walletconnect/storage-adapter.ts` over `chrome.storage.local`,
namespaced under a new `STORAGE_KEYS.WALLETCONNECT` prefix alongside the
existing keys in `extension/shared/constants.ts`.

⚠️ The WC keychain contains session symmetric keys. `chrome.storage.local` is
unencrypted at rest — same trust level as the existing `approvedOrigins`, but
session keys allow *message decryption*, so: scope storage keys tightly, wipe
them on wallet reset, and document this in the threat model (§9). Encrypting
the WC keychain under the wallet-unlock key is a possible hardening follow-up
(**O-4**).

### 4.5 Pairing entry points

- **Paste `wc:` URI**: new `WalletConnectPairScreen` reachable from settings
  and from a "Connect to dapp" affordance on `HomeScreen`. Input validation:
  must parse as a v2 URI (`wc:<topic>@2?...`); reject v1.
- **QR scan**: extension popups can use `getUserMedia`; gate behind the same
  screen with a "Scan QR" tab. (Mobile app makes this the primary path.)
- Pairing then triggers `session_proposal` → approval flow below.

### 4.6 Session proposal & request UX

- `session_proposal` → create a `pendingRequests` entry of a new type
  `'wc-connect'` → `createApprovalPopup()` → `ConnectApprovalScreen`, extended
  to show: dapp name/url/icon from `proposer.metadata`, the **Verify API
  verdict** (✅ verified origin / ⚠️ mismatch / ❌ flagged-as-scam — hard-block
  the scam case), requested methods, and the account being exposed.
  On approve: `walletkit.approveSession()` with namespaces built from
  `namespace.ts` constants and the wallet's CAIP-10 account.
- `session_request` → map `request.params.request.{method,params}` through
  `routeProviderRequest({kind:'walletconnect', ...})`; the existing
  `SignMessageScreen` / `TransactionApprovalScreen` flows fire as they do
  today. Approval screens display the WC peer metadata where they currently
  show the origin.
- Respect the existing `REQUEST_EXPIRATION_MS` (5 min,
  `background/index.ts:68`); WC requests also carry their own expiry — honor
  whichever is sooner, and `respondSessionRequest` with error `4001`-style
  rejection on timeout (mirroring `cancelPendingRequest()`).
- **Session management**: extend `WalletPermissionsScreen` with an "Active
  WalletConnect sessions" section — peer metadata, connected since, disconnect
  button (`walletkit.disconnectSession`). Handle inbound `session_delete` to
  clean up state.
- Locked wallet: if a `session_request` arrives while locked, queue it and
  route through the existing unlock flow first (same behavior the injected
  path has via `ensureSessionRestored()` / unlock session cache).

### 4.7 Extension task list

| # | Task | Size |
|---|---|---|
| W1 | Extract `routeProviderRequest()` from `background/index.ts` (pure refactor, no behavior change, tested against existing dapp flows) | M |
| W2 | Namespace constants in SDK + `walletconnect/namespace.ts` | S |
| W3 | `storage-adapter.ts` + storage keys + wipe-on-reset | S |
| W4 | WalletKit service in SW with alarms keepalive (spike, behind a dev flag) | M |
| W5 | `session_proposal` → ConnectApprovalScreen (incl. Verify API display) | M |
| W6 | `session_request` → router → existing approval screens | M |
| W7 | Offscreen-document relay host; remove alarms keepalive | L |
| W8 | Pairing UI (paste + QR) | M |
| W9 | Session management in WalletPermissionsScreen + `session_delete` | M |
| W10 | Locked-wallet queueing, request expiry, error mapping | M |
| W11 | E2E test: demo dapp ↔ extension over real relay | M |

---

## 5. Dapp side: `nockbox/iris-sdk`

### 5.1 Transport abstraction

`NockchainProvider` (`src/provider.ts`) hard-fails in its constructor if
`window.nockchain` is absent (`WalletNotInstalledError`). Refactor:

```ts
interface WalletTransport {
  request<T>(args: RpcRequest): Promise<T>;
  on(event: NockchainEvent, cb: EventListener): void;
  disconnect?(): Promise<void>;
}

class InjectedTransport implements WalletTransport { /* current postMessage logic */ }
class WalletConnectTransport implements WalletTransport { /* wraps @walletconnect/sign-client */ }

// Back-compat: zero-arg constructor keeps exact current behavior.
new NockchainProvider();                                  // injected, throws if absent
new NockchainProvider({ transport: walletConnect({ projectId, metadata }) });
```

`WalletConnectTransport` responsibilities:

- `connect()`: `signClient.connect({ requiredNamespaces: {...nockchain...} })`,
  surface the URI via a `displayUri` callback (dapp renders QR itself or we
  ship a tiny optional modal — keep the core SDK headless, modal as a separate
  entry point like the existing `./wasm` export).
- Map `nock_connect` semantics: with WC, `requestAccounts()` resolves from the
  approved session's `namespaces.nockchain.accounts` (parse CAIP-10) instead
  of issuing an RPC.
- All other `PROVIDER_METHODS` pass through as `signClient.request({ topic,
  chainId: NOCKCHAIN_CHAINS.mainnet, request })`.
- Session persistence/restore (sign-client does this via localStorage by
  default — fine in a dapp context), `session_event` → SDK event emitter,
  `session_delete` → emit `disconnect`.

### 5.2 SDK task list

| # | Task | Size |
|---|---|---|
| S1 | Export namespace constants (single source of truth, §3.5) | S |
| S2 | `WalletTransport` interface + `InjectedTransport` extraction (no behavior change) | M |
| S3 | `WalletConnectTransport` over `@walletconnect/sign-client` | L |
| S4 | CAIP-10 parse/format helpers | S |
| S5 | `examples/` demo dapp with QR pairing (doubles as the E2E fixture for W11) | M |
| S6 | README + typedoc updates; minor version bump | S |

Bundle-size note: sign-client + relay deps are heavy (~hundreds of KB).
WalletConnect support must be a **separate export path**
(`@nockbox/iris-sdk/walletconnect`) so injected-only dapps pay nothing.

---

## 6. Mobile Iris app (separate repo, referenced here)

The mobile repo isn't in this workspace; this section is the contract it
builds against.

- Integrate `@reown/walletkit` (React Native) or the native WalletKit SDKs.
  Mobile has no MV3 problem — but backgrounded apps miss relay messages, so
  wire **Reown's push notification (echo) server** for `session_request`
  wake-ups. This is the standard mobile WC setup.
- Register deep link / universal link: `iris://wc?uri=...` (+
  `https://iris.nockbox.com/wc?uri=...` universal links) so mobile-browser
  dapps can hand off without QR.
- Reuses the same namespace constants from `@nockbox/iris-sdk` (S1) — if the
  mobile app is TypeScript/RN it imports them directly; if native, the
  namespace doc (§3.5) is normative.
- Signing on mobile presumably goes through `iris-rs`/wasm bindings the same
  way the extension does — **no `iris-rs` changes are expected** for
  WalletConnect itself (it's pure transport; signing inputs/outputs are
  unchanged).

---

## 7. Reown Cloud / ecosystem chores

- Create Reown Cloud projects (extension, mobile, demo dapp) → project IDs.
  Free tier is fine to start; relay usage limits are generous.
- Submit Iris to the **Reown Explorer / WalletGuide** once mobile ships, with
  the `nockchain:` namespace declared — this is what makes Iris appear in
  dapp wallet-selection modals that support custom namespaces.
- Optionally publish the namespace spec to the
  [CAIP namespaces registry](https://github.com/ChainAgnostic/namespaces)
  (`namespaces/nockchain`) — low effort, makes the convention citable.

---

## 8. Sequencing & rough estimates

Phases gate on each other; tasks within a phase parallelize across the two
repos.

| Phase | Contents | Estimate |
|---|---|---|
| **P0 — Spec & spike** | §3 namespace doc + O-1 decision; Reown projects; throwaway spike: WalletKit in SW with alarms keepalive talking to a hacked-up sign-client page (validates relay + namespace end to end) | 2–3 days |
| **P1 — Refactors** | W1 (router extraction), S2 (transport extraction) — both pure refactors, independently shippable | 3–4 days |
| **P2 — Core integration** | W2–W6, S1, S3, S4: extension accepts a pasted URI, full propose→approve→request→sign loop against the demo dapp | 1.5–2 weeks |
| **P3 — Production hardening** | W7 (offscreen relay host), W8 (pairing UI polish + QR), W9, W10, S5, W11 | 1–1.5 weeks |
| **P4 — Release & ecosystem** | S6, store-listing update (new `offscreen` permission triggers Chrome Web Store re-review — flag early), §7 chores | 2–3 days |
| **P5 — Mobile** | §6, in the mobile repo; can start as soon as P0 is done since it only depends on the namespace spec | parallel track |

Total for extension + SDK: **~4–5 engineer-weeks**, dominated by P2/P3.

---

## 9. Security considerations

1. **Origin spoofing**: injected-path trust comes from `sender.origin`; WC
   metadata is self-reported by the dapp. Mitigation: surface the **Verify
   API** verdict in `ConnectApprovalScreen` (W5) and hard-block
   `isScam === true`. Never display `metadata.url` as if it were verified
   without the attestation.
2. **Session key material at rest**: see §4.4. Wipe WC storage on wallet
   reset/uninstall-reinstall; consider unlock-key encryption (O-4).
3. **Method scoping**: approve sessions with *exactly*
   `NOCKCHAIN_WC_METHODS` — never echo back whatever the proposal asked for.
   Reject proposals requiring chains/methods we don't support
   (`getSdkError('UNSUPPORTED_METHODS')` etc.).
4. **Request expiry**: honor both WC request expiry and our
   `REQUEST_EXPIRATION_MS` (sooner wins) so stale popups can't authorize
   minutes-old requests.
5. **Relay availability ≠ integrity**: relay sees only ciphertext, but it can
   drop/delay. No security impact, but UX must treat "no response" as
   unknown-outcome for `nock_sendTransaction` (same way the injected path's
   timeout messaging works in `inpage/index.ts`).
6. **Phishing via pairing links**: pasted `wc:` URIs can come from anywhere.
   The approval screen — not the pairing screen — is the security boundary;
   pairing alone must grant nothing (it doesn't, by protocol, but our UI copy
   should make that clear).
7. Run the standard pre-release security review on P2/P3 branches (the repo's
   existing process).

---

## 10. Open questions

| # | Question | Owner / when |
|---|---|---|
| O-1 | CAIP-2 reference: `mainnet` vs truncated genesis hash? (Recommend genesis hash; decide in P0) | P0 |
| O-2 | Does the mobile app share the RN/TS stack (can it import `@nockbox/iris-sdk` constants directly)? | before P5 |
| O-3 | Min Chrome version: `chrome.offscreen` needs 109+. Acceptable floor? (Manifest currently doesn't set `minimum_chrome_version`.) | P3 |
| O-4 | Encrypt WC keychain under wallet-unlock key, or accept `chrome.storage.local` plaintext parity with `approvedOrigins`? | P3 |
| O-5 | Expose `nock_estimateTransactionFee` over WC at launch, or wallet-side-only fee estimation (mirroring the recent optional-fee work in `nock_sendTransaction`)? | P2 |
| O-6 | Self-hosted relay on the long-term roadmap (decentralization / availability), or Reown-hosted indefinitely? | post-launch |

---

## 11. Decision log

- **2026-06-11** — Confirmed no prior WalletConnect work exists on any branch
  of `iris`, `iris-rs`, or `iris-sdk` (full-content + commit-message search).
  This plan starts from scratch.
- **2026-06-11** — Offscreen document chosen over alarms keepalive for the
  relay socket (§4.3); alarms approach allowed only for the P0 spike.
- **2026-06-11** — WalletConnect ships as an additive transport; injected
  provider remains the default and the SDK's zero-arg constructor behavior is
  frozen for back-compat (§5.1).
