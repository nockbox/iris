/// <reference types="chrome" />
/**
 * Service Worker: Wallet controller and message router
 * Handles provider requests from content script and popup UI
 */

import { Vault } from '../shared/vault';
import { isNockAddress } from '../shared/validators';
import { assertNativeRawTx } from '../shared/sign-raw-tx-compat';
import {
  isSignTxRequest,
  isEvmAddress,
  mapRpcRequest,
  mapRpcResponse,
  RPC_API_VERSION,
} from '@nockbox/iris-sdk';
import type { RpcRequest, RpcResponse, ConnectResponse } from '@nockbox/iris-sdk';
import { ensureWasmInitialized } from '../shared/wasm-utils';
import wasm from '../shared/sdk-wasm.js';
import type { Nicks } from '@nockbox/iris-sdk/wasm';
import type { Digest } from '@nockbox/iris-sdk/wasm';
import {
  PROVIDER_METHODS,
  INTERNAL_METHODS,
  ERROR_CODES,
  ALARM_NAMES,
  AUTOLOCK_MINUTES,
  AUTOLOCK_ALLOWED_MINUTES,
  STORAGE_KEYS,
  SESSION_STORAGE_KEYS,
  USER_ACTIVITY_METHODS,
  UI_CONSTANTS,
  APPROVAL_CONSTANTS,
  CHAIN_ID,
  DISPLAY_MODES,
  DEFAULT_DISPLAY_MODE,
  RUNTIME_MESSAGE_TYPES,
} from '../shared/constants';
import type { DisplayMode, ApprovalType } from '../shared/constants';
import { getEffectiveRpcConfig } from '../shared/rpc-config';
import type { RpcConfig } from '../shared/rpc-config';
import type {
  TransactionRequest,
  SignRequest,
  ConnectRequest,
  SignRawTxRequest,
  WalletTransaction,
} from '../shared/types';
import {
  SIDE_PANEL_DEFAULT_PATH,
  LEGACY_SIGN_RAW_TX_METHOD,
  isSidePanelGestureRequest,
} from '../shared/side-panel';
import {
  buildPendingApprovalSessionSnapshot,
  restorePendingApprovalSessionSnapshot,
  pendingApprovalOriginMatches,
  pendingApprovalAccountMatches,
} from '../shared/pending-approval-state';
import {
  persistPendingApprovalSession,
  loadPendingApprovalSession,
} from '../shared/pending-approvals-session';
import { resolveTransactionFeeForBuild } from '../shared/transaction-fee';

const vault = new Vault();
let lastActivity = Date.now();
let autoLockMinutes = AUTOLOCK_MINUTES;
let manuallyLocked = false; // Track if user manually locked (don't auto-unlock)
let approvalWindowId: number | null = null; // Track the approval popup window for reuse
let isCreatingWindow = false; // Prevent race condition when creating window
let currentRequestId: string | null = null; // Currently displayed request
let currentRequestType: ApprovalType | null = null; // Type of currently displayed request
let requestQueue: Array<{
  id: string;
  type: 'connect' | 'transaction' | 'sign-message' | 'sign-raw-tx';
}> = []; // Queued requests

/**
 * In-memory cache of approved origins
 * Loaded from storage on startup, persisted on changes
 */
let approvedOrigins = new Set<string>();

/**
 * Request expiration time (5 minutes)
 * Prevents replay attacks on approval requests
 */
const REQUEST_EXPIRATION_MS = 5 * 60 * 1000; // 5 minutes

function normalizeAutoLockMinutes(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return AUTOLOCK_ALLOWED_MINUTES.includes(parsed as (typeof AUTOLOCK_ALLOWED_MINUTES)[number])
    ? parsed
    : AUTOLOCK_MINUTES;
}

/**
 * RPC connection status
 * Updated by popup via REPORT_RPC_STATUS when actual gRPC calls succeed/fail
 */
let isRpcConnected = true;

type UnlockSessionCache = {
  key: number[];
};

let sessionRestorePromise: Promise<void> | null = null;

// In-flight UTXO sync to prevent concurrent sync passes from racing with each other.
// Keyed by account address (or "*" for all-accounts sync) so that a sync for one
// account doesn't cause a caller asking for a different account to receive a
// stale reused result.
const utxoSyncInFlight = new Map<
  string,
  Promise<{
    ok: boolean;
    results: Record<string, { success: boolean; error?: string }>;
  }>
>();

// Track pending sub-wallet discoveries (fire-and-forget) so we don't double-schedule.
const subwalletDiscoveryInFlight = new Set<string>();
const subwalletDiscoveryAfterInitialSync = new Set<string>();

async function clearUnlockSessionCache(): Promise<void> {
  try {
    await chrome.storage.session?.remove(SESSION_STORAGE_KEYS.UNLOCK_CACHE);
  } catch (error) {
    console.error('[Background] Failed to clear unlock cache:', error);
  }
}

async function persistUnlockSession(): Promise<void> {
  const sessionStorage = chrome.storage.session;
  if (!sessionStorage || vault.isLocked()) {
    return;
  }

  const encryptionKey = vault.getEncryptionKey();
  if (!encryptionKey) {
    return;
  }

  try {
    const rawKey = new Uint8Array(await crypto.subtle.exportKey('raw', encryptionKey));
    await sessionStorage.set({
      [SESSION_STORAGE_KEYS.UNLOCK_CACHE]: Array.from(rawKey),
    });
  } catch (error) {
    console.error('[Background] Failed to persist unlock session:', error);
  }
}

async function restoreUnlockSession(): Promise<void> {
  const sessionStorage = chrome.storage.session;
  if (!sessionStorage) {
    return;
  }

  const stored = await sessionStorage.get([SESSION_STORAGE_KEYS.UNLOCK_CACHE]);
  const cached = stored[SESSION_STORAGE_KEYS.UNLOCK_CACHE] as UnlockSessionCache['key'] | undefined;

  if (!cached || cached.length === 0) {
    return;
  }

  // Respect manual lock - never auto-unlock if user explicitly locked
  if (manuallyLocked) {
    await clearUnlockSessionCache();
    return;
  }

  // Respect auto-lock timeout window
  if (autoLockMinutes > 0) {
    const idleMs = Date.now() - lastActivity;
    if (idleMs >= autoLockMinutes * 60_000) {
      await clearUnlockSessionCache();
      return;
    }
  }

  try {
    const key = await crypto.subtle.importKey(
      'raw',
      new Uint8Array(cached),
      { name: 'AES-GCM' },
      false,
      ['encrypt', 'decrypt']
    );
    const result = await vault.unlockWithKey(key);
    if ('error' in result) {
      await clearUnlockSessionCache();
    }
  } catch (error) {
    console.error('[Background] Failed to restore unlock session:', error);
    await clearUnlockSessionCache();
  }
}

async function ensureSessionRestored(): Promise<void> {
  if (!vault.isLocked()) {
    return;
  }

  if (!sessionRestorePromise) {
    sessionRestorePromise = restoreUnlockSession().finally(() => {
      sessionRestorePromise = null;
    });
  }

  await sessionRestorePromise;
}

/**
 * Load approved origins from storage
 */
async function loadApprovedOrigins(): Promise<void> {
  const stored = await chrome.storage.local.get([STORAGE_KEYS.APPROVED_ORIGINS]);
  const origins = Array.isArray(stored[STORAGE_KEYS.APPROVED_ORIGINS])
    ? (stored[STORAGE_KEYS.APPROVED_ORIGINS] as unknown[])
    : [];
  const normalizedOrigins = origins
    .map(origin => normalizeWebOrigin(origin))
    .filter((origin): origin is string => Boolean(origin));

  approvedOrigins = new Set(normalizedOrigins);

  // Older versions stored full page URLs. Persist the least-privilege origin form.
  if (
    origins.length !== approvedOrigins.size ||
    origins.some(origin => typeof origin !== 'string' || !approvedOrigins.has(origin))
  ) {
    await saveApprovedOrigins();
  }
}

/**
 * Save approved origins to storage
 */
async function saveApprovedOrigins(): Promise<void> {
  await chrome.storage.local.set({
    [STORAGE_KEYS.APPROVED_ORIGINS]: Array.from(approvedOrigins),
  });
}

/**
 * Add an origin to the approved list
 */
async function approveOrigin(origin: string): Promise<void> {
  approvedOrigins.add(origin);
  await saveApprovedOrigins();
}

/**
 * Remove an origin from the approved list
 */
async function revokeOrigin(origin: string): Promise<void> {
  approvedOrigins.delete(origin);
  await saveApprovedOrigins();
}

/**
 * Check if origin is approved for provider method access
 */
function isOriginApproved(origin: string): boolean {
  // Allow file:// protocol for local testing in development only
  if (import.meta.env.DEV && origin.startsWith('file://')) {
    return true;
  }

  // Check if origin is in approved list
  return approvedOrigins.has(origin);
}

function normalizeWebOrigin(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) {
    return null;
  }

  if (import.meta.env.DEV && value.startsWith('file://')) {
    return 'file://';
  }

  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

function getSenderOrigin(sender: chrome.runtime.MessageSender): string | null {
  return normalizeWebOrigin(sender.origin) ?? normalizeWebOrigin(sender.url);
}

function cancelPendingRequest(requestId: string, code?: number, message?: string): void {
  const request = pendingRequests.get(requestId);
  if (!request) {
    return;
  }
  pendingRequests.delete(requestId);
  request.sendResponse({
    error: { code: code || 4001, message: message || 'Request was cancelled' },
  });
  if (currentRequestId === requestId) {
    currentRequestId = null;
    currentRequestType = null;
  }
  void syncPendingApprovalsSession();
}

function orphanedProviderResponse(_response: unknown): void {
  // The content-script callback is gone after a service worker restart.
}

async function syncPendingApprovalsSession(): Promise<void> {
  const snapshot = buildPendingApprovalSessionSnapshot(
    pendingRequests,
    currentRequestId,
    currentRequestType,
    requestQueue,
    isRequestExpired
  );
  await persistPendingApprovalSession(snapshot);
}

async function restorePendingApprovalsSession(): Promise<void> {
  const snapshot = await loadPendingApprovalSession();
  if (!snapshot) {
    return;
  }

  const restored = restorePendingApprovalSessionSnapshot(snapshot, isRequestExpired);
  pendingRequests.clear();

  for (const [id, entry] of Object.entries(restored.pending)) {
    pendingRequests.set(id, {
      request: entry.request,
      origin: entry.origin,
      tabId: entry.tabId,
      documentId: entry.documentId,
      sendResponse: orphanedProviderResponse,
      restoredWithoutResponder: true,
    });
  }

  requestQueue = restored.requestQueue;
  currentRequestId = restored.currentRequestId;
  currentRequestType = currentRequestId
    ? approvalTypeForRequest(pendingRequests.get(currentRequestId)!.request)
    : null;

  if (
    currentRequestId &&
    currentRequestType &&
    (await getDisplayMode()) === DISPLAY_MODES.SIDE_PANEL
  ) {
    await notifyApprovalPending(currentRequestId, currentRequestType);
  }
}

/**
 * Check if a request timestamp has expired
 * @param timestamp - Request creation timestamp
 * @returns true if expired, false if still valid
 */
function isRequestExpired(timestamp: number): boolean {
  return Date.now() - timestamp > REQUEST_EXPIRATION_MS;
}

async function isPendingRequesterActive(request: PendingRequest): Promise<boolean> {
  if (request.tabId === undefined) {
    return false;
  }

  try {
    const tab = await chrome.tabs.get(request.tabId);
    if (!pendingApprovalOriginMatches(request.request, normalizeWebOrigin(tab.url))) {
      return false;
    }

    if (!request.documentId) {
      // Legacy snapshots lack a document ID. At least require the same tab origin
      // and a live Iris content script before allowing a sensitive operation.
      const response = await chrome.tabs.sendMessage(request.tabId, {
        type: RUNTIME_MESSAGE_TYPES.REQUESTER_PING,
      });
      return response?.ok === true;
    }

    const response = await chrome.tabs.sendMessage(
      request.tabId,
      { type: RUNTIME_MESSAGE_TYPES.REQUESTER_PING },
      { documentId: request.documentId }
    );
    return response?.ok === true;
  } catch {
    return false;
  }
}

async function validatePendingApproval(
  requestId: string,
  pending: PendingRequest,
  sendResponse: (response: unknown) => void
): Promise<boolean> {
  if (isRequestExpired(pending.request.timestamp)) {
    cancelPendingRequest(requestId, 4003, 'Request expired');
    processNextRequest();
    sendResponse({ error: 'Request expired' });
    return false;
  }

  if (pending.restoredWithoutResponder) {
    cancelPendingRequest(
      requestId,
      4900,
      'The wallet restarted while this request was pending; request the action again'
    );
    processNextRequest();
    sendResponse({
      error: 'The wallet restarted while this request was pending; request the action again',
    });
    return false;
  }

  if (pending.processing) {
    sendResponse({ error: 'Request is already being processed' });
    return false;
  }
  pending.processing = true;

  if (!(await isPendingRequesterActive(pending))) {
    cancelPendingRequest(requestId, 4001, 'Requesting page is no longer active');
    processNextRequest();
    sendResponse({ error: 'Requesting page is no longer active' });
    return false;
  }

  if (isConnectRequest(pending.request) && !pending.request.accountAddress && !vault.isLocked()) {
    pending.request.accountAddress = vault.getAddress();
    void syncPendingApprovalsSession();
  }

  if (!pendingApprovalAccountMatches(pending.request, vault.getCurrentAccount()?.address ?? null)) {
    cancelPendingRequest(requestId, 4001, 'Selected account changed; request the action again');
    processNextRequest();
    sendResponse({ error: 'Selected account changed; request the action again' });
    return false;
  }

  return true;
}

/** Parse amount/fee from message boundary. Returns Nicks (string). Throws on invalid input. */
function parseNicksParam(
  input: unknown,
  field: string,
  opts: { required?: boolean; allowZero?: boolean } = {}
): Nicks {
  const { required = true, allowZero = false } = opts;

  if (input === undefined || input === null) {
    if (!required) return '0' as Nicks;
    throw new Error(`Missing ${field}`);
  }

  const value =
    typeof input === 'number'
      ? input
      : typeof input === 'string'
        ? /^\d+$/.test(input.trim())
          ? Number(input.trim())
          : NaN
        : NaN;

  if (
    !Number.isInteger(value) ||
    value < 0 ||
    (!allowZero && value === 0) ||
    value > Number.MAX_SAFE_INTEGER
  ) {
    throw new Error(`Invalid ${field}`);
  }

  return String(value) as Nicks;
}

type IncomingRpcRequest = {
  method?: string;
  params?: any;
  api?: unknown;
};

const LEGACY_RPC_API_VERSION = '0';

/**
 * Provider requests that do not specify `api` are treated as legacy API 0.
 */
function resolveSourceApiVersion(requestApi: unknown): string {
  return typeof requestApi === 'string' && requestApi.trim()
    ? requestApi.trim()
    : LEGACY_RPC_API_VERSION;
}

function isProviderMethod(method: unknown): method is string {
  return (
    method === PROVIDER_METHODS.CONNECT ||
    method === PROVIDER_METHODS.SIGN_MESSAGE ||
    method === PROVIDER_METHODS.SEND_TRANSACTION ||
    method === PROVIDER_METHODS.GET_WALLET_INFO ||
    method === PROVIDER_METHODS.SIGN_TX ||
    method === PROVIDER_METHODS.ESTIMATE_TRANSACTION_FEE ||
    // Legacy v0 API method
    method === LEGACY_SIGN_RAW_TX_METHOD
  );
}

async function bridgeIncomingProviderPayload(
  sourceRequest: IncomingRpcRequest
): Promise<IncomingRpcRequest> {
  if (!sourceRequest?.method) {
    return sourceRequest;
  }

  if (!isProviderMethod(sourceRequest.method)) {
    return sourceRequest;
  }

  const sourceApi = resolveSourceApiVersion(sourceRequest.api);
  if (sourceApi === RPC_API_VERSION) {
    return {
      ...sourceRequest,
      api: sourceApi,
    };
  }

  const mappedRequest = mapRpcRequest(sourceRequest as RpcRequest, sourceApi, RPC_API_VERSION);

  return {
    ...(mappedRequest as IncomingRpcRequest),
    api: sourceApi,
  };
}

function toRpcResponse(response: unknown): RpcResponse<unknown> {
  if (
    response &&
    typeof response === 'object' &&
    'error' in (response as Record<string, unknown>)
  ) {
    return response as RpcResponse<unknown>;
  }
  return { result: response };
}

function bridgeOutgoingProviderResponse(
  sourceRequest: IncomingRpcRequest,
  response: unknown
): unknown {
  if (!sourceRequest?.method || !isProviderMethod(sourceRequest.method)) {
    return response;
  }

  const sourceApi = resolveSourceApiVersion(sourceRequest.api);
  const mappedRequest = mapRpcRequest(sourceRequest as RpcRequest, sourceApi, RPC_API_VERSION);
  const bridged = mapRpcResponse(
    mappedRequest.method,
    toRpcResponse(response),
    RPC_API_VERSION,
    sourceApi
  );
  if (bridged.error) {
    return { error: bridged.error };
  }
  return bridged.result;
}

function toInvalidParamsError(err: unknown): { error: { code: number; message: string } } {
  return {
    error: {
      code: -32602,
      message: err instanceof Error ? err.message : 'Invalid params',
    },
  };
}

function toInternalProviderError(err: unknown): { error: { code: number; message: string } } {
  return {
    error: {
      code: -32603,
      message: err instanceof Error ? err.message : 'Internal wallet error',
    },
  };
}

function buildConnectResponse(address: string, rpcConfig: RpcConfig): ConnectResponse {
  const { txEngineActivationHeights, coinbaseTimelockBlocks } = rpcConfig;
  if (!txEngineActivationHeights || coinbaseTimelockBlocks == null) {
    throw new Error('RPC config is missing tx engine or coinbase timelock settings');
  }

  return {
    account: {
      type: 'v1',
      address: address as Digest,
    },
    rpcConfig: {
      rpcUrl: rpcConfig.rpcUrl,
      networkName: rpcConfig.networkName,
      blockExplorerUrl: rpcConfig.blockExplorerUrl,
      txEngineActivationHeights,
      coinbaseTimelockBlocks,
    },
  };
}

/**
 * Pending approval requests
 * Maps request ID to the request data and response callback
 */
interface PendingRequest {
  request: TransactionRequest | SignRequest | ConnectRequest | SignRawTxRequest;
  sendResponse: (response: any) => void;
  origin: string;
  needsUnlock?: boolean; // Flag indicating request is waiting for wallet unlock
  tabId?: number;
  documentId?: string;
  /** A service-worker restart lost the original provider callback; never execute this request. */
  restoredWithoutResponder?: boolean;
  /** Prevent duplicate approval surfaces from executing the same request concurrently. */
  processing?: boolean;
}

const pendingRequests = new Map<string, PendingRequest>();

/**
 * Type guard to check if a request is a ConnectRequest
 */
function isConnectRequest(
  request: TransactionRequest | SignRequest | ConnectRequest | SignRawTxRequest
): request is ConnectRequest {
  return (
    'timestamp' in request && !('message' in request) && !('to' in request) && !('rawTx' in request)
  );
}

/**
 * Type guard to check if a request is a SignRequest
 */
function isSignRequest(
  request: TransactionRequest | SignRequest | ConnectRequest | SignRawTxRequest
): request is SignRequest {
  return 'message' in request;
}

/**
 * Type guard to check if a request is a SignRawTxRequest
 */
function isSignRawTxRequest(
  request: TransactionRequest | SignRequest | ConnectRequest | SignRawTxRequest
): request is SignRawTxRequest {
  return (
    'rawTx' in request &&
    'inputs' in request &&
    'inputsVerified' in request &&
    'inputCount' in request &&
    'transactionId' in request &&
    'reviewBlockHeight' in request &&
    'accountAddress' in request
  );
}

/**
 * Type guard to check if a request is a TransactionRequest
 */
function isTransactionRequest(
  request: TransactionRequest | SignRequest | ConnectRequest | SignRawTxRequest
): request is TransactionRequest {
  return 'to' in request;
}

function approvalTypeForRequest(
  request: TransactionRequest | SignRequest | ConnectRequest | SignRawTxRequest
): ApprovalType {
  if (isSignRawTxRequest(request)) return 'sign-raw-tx';
  if (isTransactionRequest(request)) return 'transaction';
  if (isSignRequest(request)) return 'sign-message';
  return 'connect';
}

async function getDisplayMode(): Promise<DisplayMode> {
  if (!chrome.sidePanel) {
    return DISPLAY_MODES.POPUP;
  }

  const stored = await chrome.storage.local.get([STORAGE_KEYS.DISPLAY_MODE]);
  const mode = stored[STORAGE_KEYS.DISPLAY_MODE];
  return mode === DISPLAY_MODES.POPUP || mode === DISPLAY_MODES.SIDE_PANEL
    ? mode
    : DEFAULT_DISPLAY_MODE;
}

async function applyDisplayMode(mode: DisplayMode): Promise<void> {
  const effectiveMode =
    mode === DISPLAY_MODES.SIDE_PANEL && chrome.sidePanel
      ? DISPLAY_MODES.SIDE_PANEL
      : DISPLAY_MODES.POPUP;

  if (effectiveMode === DISPLAY_MODES.SIDE_PANEL) {
    await chrome.action.setPopup({ popup: '' });
    await chrome.sidePanel!.setPanelBehavior({ openPanelOnActionClick: true });
    await chrome.sidePanel!.setOptions({ path: SIDE_PANEL_DEFAULT_PATH, enabled: true });
  } else {
    await chrome.action.setPopup({ popup: 'popup/index.html' });
    if (chrome.sidePanel) {
      await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
    }
  }
}

async function notifyApprovalPending(requestId: string, type: ApprovalType): Promise<void> {
  try {
    await chrome.runtime.sendMessage({
      type: RUNTIME_MESSAGE_TYPES.APPROVAL_PENDING,
      requestId,
      approvalType: type,
    });
  } catch {
    // Side panel may not be open yet; it will query on mount via GET_PENDING_APPROVAL
  }
}

async function openSidePanelForApproval(tabId?: number): Promise<void> {
  if (!chrome.sidePanel) {
    return;
  }

  try {
    if (tabId !== undefined) {
      await chrome.sidePanel.setOptions({
        tabId,
        path: SIDE_PANEL_DEFAULT_PATH,
        enabled: true,
      });
      await chrome.sidePanel.open({ tabId });
      return;
    }

    const currentWindow = await chrome.windows.getLastFocused({ populate: false });
    if (currentWindow.id !== undefined) {
      await chrome.sidePanel.open({ windowId: currentWindow.id });
    }
  } catch (error) {
    // Panel may already be open, or open() may lack a user gesture — routing still works via message.
    console.warn('[Background] sidePanel.open failed (panel may already be open):', error);
  }
}

async function routeApprovalToSidePanel(
  requestId: string,
  type: ApprovalType,
  tabId?: number
): Promise<void> {
  await openSidePanelForApproval(tabId);
  await notifyApprovalPending(requestId, type);
}

async function createPopupWithFallback(opts: any): Promise<any> {
  // First try: with left/top
  try {
    return await chrome.windows.create(opts);
  } catch (e) {
    // Retry: remove left/top
    const { left, top, ...rest } = opts;

    return await chrome.windows.create(rest);
  }
}

/**
 * Create an approval popup window (or reuse existing one)
 * Uses MetaMask pattern: single popup window for all approval requests
 * Queues requests if user is currently viewing another request
 */
async function createApprovalPopup(requestId: string, type: ApprovalType, tabId?: number) {
  // If user is currently viewing a different request, queue this one
  if (currentRequestId !== null && currentRequestId !== requestId) {
    // Check if already in queue to prevent duplicates
    const alreadyQueued = requestQueue.some(r => r.id === requestId);
    if (!alreadyQueued) {
      requestQueue.push({ id: requestId, type });
    }
    void syncPendingApprovalsSession();
    return;
  }

  // Mark this request as currently displayed
  currentRequestId = requestId;
  currentRequestType = type;

  const displayMode = await getDisplayMode();
  if (displayMode === DISPLAY_MODES.SIDE_PANEL) {
    await routeApprovalToSidePanel(requestId, type, tabId);
    void syncPendingApprovalsSession();
    return;
  }

  let hashPrefix: string;
  if (type === 'connect') {
    hashPrefix = APPROVAL_CONSTANTS.CONNECT_HASH_PREFIX;
  } else if (type === 'transaction') {
    hashPrefix = APPROVAL_CONSTANTS.TRANSACTION_HASH_PREFIX;
  } else if (type === 'sign-raw-tx') {
    hashPrefix = APPROVAL_CONSTANTS.SIGN_RAW_TX_HASH_PREFIX;
  } else {
    hashPrefix = APPROVAL_CONSTANTS.SIGN_MESSAGE_HASH_PREFIX;
  }
  const popupUrl = chrome.runtime.getURL(`popup/index.html#${hashPrefix}${requestId}`);

  // Try to reuse existing approval window
  if (approvalWindowId !== null) {
    try {
      const existingWindow = await chrome.windows.get(approvalWindowId);

      // Window still exists - update it with new request
      if (existingWindow.tabs && existingWindow.tabs[0]?.id) {
        await chrome.tabs.update(existingWindow.tabs[0].id, { url: popupUrl });
        await chrome.windows.update(approvalWindowId, { focused: true });
        return; // Done - reused existing window
      } else {
        await chrome.windows.remove(approvalWindowId);
        approvalWindowId = null;
      }
    } catch {
      // Window was closed or doesn't exist, create new one
      approvalWindowId = null;
    }
  }

  // Prevent race condition: if window is being created, wait and retry
  if (isCreatingWindow) {
    await new Promise(resolve => setTimeout(resolve, 100));
    return createApprovalPopup(requestId, type, tabId);
  }

  // Create new approval window
  isCreatingWindow = true;
  try {
    const width = UI_CONSTANTS.POPUP_WIDTH;
    const height = UI_CONSTANTS.POPUP_HEIGHT;

    // Calculate position near top-right corner (where extension icon typically is)
    // Get the current window to determine screen bounds
    let left = 100;
    let top = 100;

    try {
      const currentWindow = await chrome.windows.getCurrent();
      if (currentWindow.left !== undefined && currentWindow.width !== undefined) {
        // Position near top-right of current window
        // Place it slightly inward from the edge for better UX
        const marginFromRight = 20;
        const marginFromTop = 80; // Below browser chrome/toolbar

        left = currentWindow.left + currentWindow.width - width - marginFromRight;
        top = currentWindow.top !== undefined ? currentWindow.top + marginFromTop : 80;

        // Ensure it's not off-screen (minimum 0)
        left = Math.max(0, left);
        top = Math.max(0, top);
      }
    } catch (err) {
      // If we can't get current window, use safe default position
      console.warn('Could not determine window position, using defaults');
    }

    const newWindow = await createPopupWithFallback({
      url: popupUrl,
      type: 'popup',
      width,
      height,
      left,
      top,
      focused: true,
    });

    approvalWindowId = newWindow.id || null;
  } finally {
    isCreatingWindow = false;
  }

  void syncPendingApprovalsSession();
}

/**
 * Process next request in queue after current request is resolved
 * Called when user approves or rejects a request
 */
function processNextRequest() {
  if (currentRequestId !== null) {
    if (pendingRequests.get(currentRequestId)?.processing) {
      return;
    }
    cancelPendingRequest(currentRequestId);
  }
  currentRequestType = null;

  while (requestQueue.length > 0) {
    const next = requestQueue.shift()!;
    if (!pendingRequests.has(next.id)) {
      continue;
    }
    void createApprovalPopup(next.id, next.type, pendingRequests.get(next.id)?.tabId).catch(
      error => {
        console.error('[Background] Failed to show next approval:', error);
      }
    );
    break;
  }

  void syncPendingApprovalsSession();
}

/**
 * Emit a wallet event to all tabs
 * This notifies dApps of wallet state changes (account switches, network changes, etc.)
 */
async function emitWalletEvent(eventType: string, data: unknown) {
  const tabs = await chrome.tabs.query({});

  for (const tab of tabs) {
    if (tab.id) {
      try {
        await chrome.tabs.sendMessage(tab.id, {
          type: 'WALLET_EVENT',
          eventType,
          data,
        });
      } catch (error) {
        // Tab might not have content script, ignore
      }
    }
  }
}

/**
 * Emit a wallet event to the popup (extension runtime).
 * chrome.tabs.sendMessage does not reach the popup; chrome.runtime.sendMessage does.
 * Safe to call when no popup is open (errors swallowed).
 */
async function emitPopupEvent(eventType: string, data: unknown) {
  try {
    await chrome.runtime.sendMessage({
      type: 'WALLET_EVENT',
      eventType,
      data,
    });
  } catch (error) {
    // Popup not open, ignore
  }
}

/**
 * Fire-and-forget sub-wallet discovery. Runs in the background without blocking
 * the SETUP/CREATE_MNEMONIC_SEED_SOURCE response. Notifies the popup when done
 * so it can refresh accounts and re-fetch balances.
 */
function scheduleSubwalletDiscovery(seedId: string): void {
  if (subwalletDiscoveryInFlight.has(seedId)) return;
  subwalletDiscoveryInFlight.add(seedId);

  (async () => {
    try {
      const result = await vault.discoverAndEnsureSubwalletsForSeed(seedId);
      const added = 'ok' in result ? result.added : 0;
      if (added > 0) {
        const cur = vault.getCurrentAccount();
        await emitWalletEvent('accountsChanged', [cur?.address].filter(Boolean));
        await emitPopupEvent('ACCOUNTS_UPDATED', { seedId, added });
      }
    } catch (err) {
      console.warn('[Background] Sub-wallet discovery failed:', err);
    } finally {
      subwalletDiscoveryInFlight.delete(seedId);
    }
  })();
}

function queueSubwalletDiscoveryAfterInitialSync(seedId: string): void {
  if (subwalletDiscoveryInFlight.has(seedId)) return;
  subwalletDiscoveryAfterInitialSync.add(seedId);
}

function scheduleQueuedSubwalletDiscoveryAfterInitialSync(accountAddress: string): void {
  const currentAccount = vault.getCurrentAccount();
  if (currentAccount?.address !== accountAddress || subwalletDiscoveryAfterInitialSync.size === 0) {
    return;
  }

  const seedIds = Array.from(subwalletDiscoveryAfterInitialSync);
  subwalletDiscoveryAfterInitialSync.clear();
  for (const seedId of seedIds) {
    scheduleSubwalletDiscovery(seedId);
  }
}

async function syncAccountUTXOsWithDedupe(
  accountAddress: string,
  accountName = accountAddress
): Promise<{
  ok: boolean;
  results: Record<string, { success: boolean; error?: string }>;
}> {
  let inFlight = utxoSyncInFlight.get(accountAddress);
  if (!inFlight) {
    inFlight = (async () => {
      const results: Record<string, { success: boolean; error?: string }> = {};

      if (vault.isLocked()) {
        results[accountAddress] = {
          success: false,
          error: ERROR_CODES.LOCKED,
        };
        return { ok: true, results };
      }

      try {
        await vault.syncAccountUTXOs(accountAddress);
        results[accountAddress] = { success: true };
        scheduleQueuedSubwalletDiscoveryAfterInitialSync(accountAddress);
      } catch (syncErr) {
        console.warn(`[Background] UTXO sync failed for ${accountName}:`, syncErr);
        results[accountAddress] = {
          success: false,
          error: syncErr instanceof Error ? syncErr.message : String(syncErr),
        };
      }

      return { ok: true, results };
    })().finally(() => {
      utxoSyncInFlight.delete(accountAddress);
    });
    utxoSyncInFlight.set(accountAddress, inFlight);
  }

  return inFlight;
}

// Initialize auto-lock setting, load approved origins, vault state, connection monitoring, and schedule alarms
const initPromise = (async () => {
  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.AUTO_LOCK_MINUTES,
    STORAGE_KEYS.LAST_ACTIVITY,
    STORAGE_KEYS.MANUALLY_LOCKED,
  ]);

  const storedMinutes = stored[STORAGE_KEYS.AUTO_LOCK_MINUTES];
  autoLockMinutes = normalizeAutoLockMinutes(storedMinutes);
  if (storedMinutes !== autoLockMinutes) {
    await chrome.storage.local.set({
      [STORAGE_KEYS.AUTO_LOCK_MINUTES]: autoLockMinutes,
    });
  }

  // Load persisted activity (survives SW restarts). Persist the migration fallback
  // immediately so repeated worker restarts cannot keep extending an unlocked session.
  const storedLastActivity = stored[STORAGE_KEYS.LAST_ACTIVITY];
  const now = Date.now();
  lastActivity =
    typeof storedLastActivity === 'number' &&
    Number.isFinite(storedLastActivity) &&
    storedLastActivity > 0 &&
    storedLastActivity <= now
      ? storedLastActivity
      : now;
  if (storedLastActivity !== lastActivity) {
    await chrome.storage.local.set({ [STORAGE_KEYS.LAST_ACTIVITY]: lastActivity });
  }

  // Load persisted manuallyLocked state
  manuallyLocked = Boolean(stored[STORAGE_KEYS.MANUALLY_LOCKED]);

  await loadApprovedOrigins();
  await vault.init(); // Load encrypted vault header to detect vault existence
  await restorePendingApprovalsSession();
  await restoreUnlockSession(); // Rehydrate unlock state if still within auto-lock window

  await applyDisplayMode(await getDisplayMode());

  if (autoLockMinutes === 0) {
    await chrome.alarms.clear(ALARM_NAMES.AUTO_LOCK);
  } else {
    scheduleAlarm();
  }
})();

chrome.runtime.onInstalled.addListener(async () => {
  await applyDisplayMode(await getDisplayMode());
});

// Clean up approval window ID when window is closed
chrome.windows.onRemoved.addListener(windowId => {
  if (windowId === approvalWindowId) {
    approvalWindowId = null;
    // If user closed window, process next request in queue
    processNextRequest();
  }
});

/**
 * Track user activity for auto-lock timer
 * Only counts user-initiated actions, not passive polling
 * Persists to storage so it survives service worker restarts
 */
async function touchActivity(method?: string) {
  if (method && USER_ACTIVITY_METHODS.has(method as any)) {
    lastActivity = Date.now();
    // Persist to storage (await to ensure it's saved)
    await chrome.storage.local.set({ [STORAGE_KEYS.LAST_ACTIVITY]: lastActivity });
  }
}

/**
 * Check if message is from popup/extension page (not content script)
 * Extension pages have chrome-extension:// URLs; content scripts have web URLs
 */
function isFromPopup(sender: chrome.runtime.MessageSender): boolean {
  // Check if the sender URL is from our extension
  const url = sender.url || '';
  const extensionId = chrome.runtime.id;
  return url.startsWith(`chrome-extension://${extensionId}/`);
}

/**
 * Synchronous user-gesture hook: open the side panel for approval-bearing
 * provider requests while the gesture from the dApp click is still active.
 * Must run before any await in the listener — awaiting consumes the gesture.
 */
function maybeOpenSidePanelOnGesture(msg: any, sender: chrome.runtime.MessageSender): void {
  if (!chrome.sidePanel || !isSidePanelGestureRequest(msg)) {
    return;
  }

  const tabId = sender.tab?.id;
  if (tabId === undefined || isFromPopup(sender)) {
    return;
  }

  chrome.sidePanel.open({ tabId }).catch(() => {
    // Gesture may have been consumed or panel already open; background
    // routing via APPROVAL_PENDING still delivers the request.
  });
}

/**
 * Handle messages from content script and popup
 */
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  maybeOpenSidePanelOnGesture(msg, _sender);

  (async () => {
    await initPromise;
    await ensureSessionRestored();
    const sourcePayload = ((msg || {}).payload || {}) as IncomingRpcRequest;
    let payload: any;
    try {
      payload = await bridgeIncomingProviderPayload(sourcePayload);
    } catch (err) {
      sendResponse(toInvalidParamsError(err));
      return;
    }
    const sendBridgedResponse = async (response: unknown): Promise<void> => {
      try {
        sendResponse(await bridgeOutgoingProviderResponse(sourcePayload, response));
      } catch (err) {
        console.error('[Background] Failed to bridge provider response:', err);
        sendResponse(toInternalProviderError(err));
      }
    };
    const senderOrigin = getSenderOrigin(_sender);
    if (isProviderMethod(payload?.method) && !senderOrigin) {
      await sendBridgedResponse({ error: ERROR_CODES.UNAUTHORIZED });
      return;
    }

    // Guard: internal methods (wallet:*) can only be called from popup/extension pages
    if (payload?.method?.startsWith('wallet:') && !isFromPopup(_sender)) {
      await sendBridgedResponse({ error: ERROR_CODES.UNAUTHORIZED });
      return;
    }

    // Only authorized extension-page methods can extend the unlock window.
    // Page-originated provider traffic is not proof of user activity.
    await touchActivity(payload?.method);

    switch (payload?.method) {
      // Provider methods (called from injected provider via content script)
      case PROVIDER_METHODS.CONNECT:
        const connectOrigin = senderOrigin!;

        // Check if origin is already approved
        if (!isOriginApproved(connectOrigin) || vault.isLocked()) {
          // Clear any existing pending unlock requests from same origin to prevent duplicates
          for (const [existingId, existingData] of pendingRequests.entries()) {
            if (
              existingData.origin === connectOrigin &&
              isConnectRequest(existingData.request) &&
              !existingData.processing
            ) {
              cancelPendingRequest(existingId);
            }
          }

          // Origin not approved - show connection approval popup
          const connectRequestId = crypto.randomUUID();
          const connectRequest: ConnectRequest = {
            id: connectRequestId,
            origin: connectOrigin,
            ...(!vault.isLocked() ? { accountAddress: vault.getAddress() } : {}),
            timestamp: Date.now(),
          };

          // Store pending request with response callback
          pendingRequests.set(connectRequestId, {
            request: connectRequest,
            sendResponse: response => {
              void sendBridgedResponse(response);
            },
            origin: connectRequest.origin,
            tabId: _sender.tab?.id,
            documentId: _sender.documentId,
          });

          void syncPendingApprovalsSession();

          // Create approval popup
          await createApprovalPopup(connectRequestId, 'connect', _sender.tab?.id);

          // Response will be sent when user approves/rejects
          return;
        }

        try {
          const connectRpcConfig = await getEffectiveRpcConfig();
          await sendBridgedResponse(buildConnectResponse(vault.getAddress(), connectRpcConfig));
        } catch (err) {
          console.error('[Background] Failed to build connect response:', err);
          await sendBridgedResponse(toInternalProviderError(err));
          return;
        }

        // Emit connect event when dApp connects successfully
        await emitWalletEvent('connect', { chainId: CHAIN_ID });
        return;

      case PROVIDER_METHODS.SIGN_MESSAGE:
        // Validate origin
        const signMessageOrigin = senderOrigin!;
        if (!isOriginApproved(signMessageOrigin)) {
          await sendBridgedResponse({ error: { code: 4100, message: 'Unauthorized origin' } });
          return;
        }

        if (vault.isLocked()) {
          await sendBridgedResponse({ error: ERROR_CODES.LOCKED });
          return;
        }

        // Create sign message approval request
        const newSignRequestId = crypto.randomUUID();
        const signMessageParams =
          payload.params && typeof payload.params === 'object'
            ? (payload.params as { message?: unknown })
            : undefined;
        if (
          typeof signMessageParams?.message !== 'string' ||
          signMessageParams.message.length > 100_000
        ) {
          await sendBridgedResponse({
            error: {
              code: -32602,
              message: 'Message must be a string of at most 100,000 characters',
            },
          });
          return;
        }
        const signRequest: SignRequest = {
          id: newSignRequestId,
          origin: signMessageOrigin,
          message: signMessageParams.message,
          accountAddress: vault.getAddress(),
          timestamp: Date.now(),
        };

        // Store pending request with response callback
        pendingRequests.set(newSignRequestId, {
          request: signRequest,
          sendResponse: response => {
            void sendBridgedResponse(response);
          },
          origin: signRequest.origin,
          tabId: _sender.tab?.id,
          documentId: _sender.documentId,
        });

        void syncPendingApprovalsSession();

        // Create approval popup
        await createApprovalPopup(newSignRequestId, 'sign-message', _sender.tab?.id);

        // Response will be sent when user approves/rejects
        return;

      case PROVIDER_METHODS.SIGN_TX:
        // Validate origin
        const signRawTxOrigin = senderOrigin!;
        if (!isOriginApproved(signRawTxOrigin)) {
          await sendBridgedResponse({ error: { code: 4100, message: 'Unauthorized origin' } });
          return;
        }

        if (vault.isLocked()) {
          await sendBridgedResponse({ error: ERROR_CODES.LOCKED });
          return;
        }

        const signTxParams = payload.params;

        if (!isSignTxRequest(signTxParams)) {
          await sendBridgedResponse({ error: { code: -32602, message: 'Invalid params' } });
          return;
        }
        let nativeRawTx: unknown;
        let review: Awaited<ReturnType<Vault['describeRawTxForApproval']>>;
        try {
          await ensureWasmInitialized();
          nativeRawTx = wasm.nockchainTxToRawTx(signTxParams.tx);
          assertNativeRawTx(nativeRawTx);
          review = await vault.describeRawTxForApproval(nativeRawTx);
        } catch (error) {
          console.warn('[Background] Rejected unverifiable raw transaction:', error);
          await sendBridgedResponse({
            error: {
              code: -32602,
              message:
                error instanceof Error ? error.message : 'Transaction inputs could not be verified',
            },
          });
          return;
        }

        const signRawTxId = crypto.randomUUID();
        const signRawTxRequest: SignRawTxRequest = {
          id: signRawTxId,
          origin: signRawTxOrigin,
          rawTx: nativeRawTx,
          inputs: review.inputs,
          inputsVerified: review.inputsVerified,
          inputCount: review.inputCount,
          outputs: review.outputs,
          transactionId: review.transactionId,
          totalFee: review.totalFee,
          reviewBlockHeight: review.blockHeight,
          accountAddress: review.accountAddress,
          timestamp: Date.now(),
        };

        // Store pending request with response callback
        pendingRequests.set(signRawTxId, {
          request: signRawTxRequest,
          sendResponse: response => {
            void sendBridgedResponse(response);
          },
          origin: signRawTxRequest.origin,
          tabId: _sender.tab?.id,
          documentId: _sender.documentId,
        });

        void syncPendingApprovalsSession();

        // Create approval popup
        await createApprovalPopup(signRawTxId, 'sign-raw-tx', _sender.tab?.id);

        // Response will be sent when user approves/rejects
        return;

      case PROVIDER_METHODS.SEND_TRANSACTION:
        // Validate origin
        const sendTxOrigin = senderOrigin!;
        if (!isOriginApproved(sendTxOrigin)) {
          await sendBridgedResponse({ error: { code: 4100, message: 'Unauthorized origin' } });
          return;
        }

        if (vault.isLocked()) {
          await sendBridgedResponse({ error: ERROR_CODES.LOCKED });
          return;
        }
        const sendTxParams =
          payload.params && typeof payload.params === 'object' ? payload.params : {};
        const { to, amount, fee } = sendTxParams;
        if (!isNockAddress(to)) {
          await sendBridgedResponse({ error: ERROR_CODES.BAD_ADDRESS });
          return;
        }
        let amountNicks: Nicks;
        let feeNicks: Nicks | undefined;
        try {
          amountNicks = parseNicksParam(amount, 'amount');
          feeNicks =
            fee === undefined || fee === null
              ? undefined // omitted: estimate below, auto-calc exact fee at build time
              : parseNicksParam(fee, 'fee', { allowZero: true });
        } catch (err) {
          await sendBridgedResponse(toInvalidParamsError(err));
          return;
        }

        // Fee omitted: estimate it now so the approval popup can display it.
        // Estimation failure rejects the request up front (better than a popup
        // with no fee or a guaranteed-to-fail broadcast).
        let displayFeeNicks: Nicks;
        if (feeNicks === undefined) {
          try {
            const sendTxEstimate = await vault.estimateTransactionFee(to, amountNicks);
            if ('error' in sendTxEstimate) {
              await sendBridgedResponse({
                error: { code: -32603, message: `Fee estimation failed: ${sendTxEstimate.error}` },
              });
              return;
            }
            displayFeeNicks = String(sendTxEstimate.fee) as Nicks;
          } catch (err) {
            console.error('[Background] Fee estimation for sendTransaction failed:', err);
            await sendBridgedResponse(toInternalProviderError(err));
            return;
          }
        } else {
          displayFeeNicks = feeNicks;
        }
        if (BigInt(amountNicks) + BigInt(displayFeeNicks) > BigInt(Number.MAX_SAFE_INTEGER)) {
          await sendBridgedResponse(
            toInvalidParamsError(new Error('Amount plus fee exceeds the supported range'))
          );
          return;
        }

        // Create transaction approval request
        const txRequestId = crypto.randomUUID();
        const txRequest: TransactionRequest = {
          id: txRequestId,
          origin: sendTxOrigin,
          to,
          amount: amountNicks,
          fee: displayFeeNicks,
          feeEstimated: feeNicks === undefined,
          accountAddress: vault.getAddress(),
          timestamp: Date.now(),
        };

        // Store pending request with response callback
        pendingRequests.set(txRequestId, {
          request: txRequest,
          sendResponse: response => {
            void sendBridgedResponse(response);
          },
          origin: txRequest.origin,
          tabId: _sender.tab?.id,
          documentId: _sender.documentId,
        });

        void syncPendingApprovalsSession();

        // Create approval popup
        await createApprovalPopup(txRequestId, 'transaction', _sender.tab?.id);

        // Response will be sent when user approves/rejects
        return;

      case PROVIDER_METHODS.GET_WALLET_INFO:
        // Validate origin
        const getInfoOrigin = senderOrigin!;
        if (!isOriginApproved(getInfoOrigin)) {
          await sendBridgedResponse({ error: { code: 4100, message: 'Unauthorized origin' } });
          return;
        }

        if (vault.isLocked()) {
          await sendBridgedResponse({ error: ERROR_CODES.LOCKED });
          return;
        }

        try {
          const walletInfoRpcConfig = await getEffectiveRpcConfig();
          await sendBridgedResponse(buildConnectResponse(vault.getAddress(), walletInfoRpcConfig));
        } catch (err) {
          console.error('[Background] Failed to build wallet info response:', err);
          await sendBridgedResponse(toInternalProviderError(err));
        }
        return;

      case PROVIDER_METHODS.ESTIMATE_TRANSACTION_FEE: {
        // Read-only like GET_WALLET_INFO: approved origin + unlocked vault, no approval popup
        const estimateFeeOrigin = senderOrigin!;
        if (!isOriginApproved(estimateFeeOrigin)) {
          await sendBridgedResponse({ error: { code: 4100, message: 'Unauthorized origin' } });
          return;
        }

        if (vault.isLocked()) {
          await sendBridgedResponse({ error: ERROR_CODES.LOCKED });
          return;
        }

        const estimateFeeParams =
          payload.params && typeof payload.params === 'object' ? payload.params : {};
        const { to: estimateFeeTo, amount: estimateFeeAmount } = estimateFeeParams;
        if (!isNockAddress(estimateFeeTo)) {
          await sendBridgedResponse({ error: ERROR_CODES.BAD_ADDRESS });
          return;
        }
        let estimateFeeAmountNicks: Nicks;
        try {
          estimateFeeAmountNicks = parseNicksParam(estimateFeeAmount, 'amount');
        } catch (err) {
          await sendBridgedResponse(toInvalidParamsError(err));
          return;
        }

        try {
          const estimateFeeResult = await vault.estimateTransactionFee(
            estimateFeeTo,
            estimateFeeAmountNicks
          );
          if ('error' in estimateFeeResult) {
            await sendBridgedResponse({
              error: { code: -32603, message: estimateFeeResult.error },
            });
            return;
          }
          // Vault returns a number; the public API uses canonical Nicks (string)
          await sendBridgedResponse({ fee: String(estimateFeeResult.fee) as Nicks });
        } catch (err) {
          console.error('[Background] Public fee estimation failed:', err);
          await sendBridgedResponse(toInternalProviderError(err));
        }
        return;
      }

      // Internal methods (called from popup)
      case INTERNAL_METHODS.SET_AUTO_LOCK:
        const newMinutes = payload.params?.[0];
        const normalizedMinutes = normalizeAutoLockMinutes(newMinutes);
        if (Number(newMinutes) !== normalizedMinutes) {
          sendResponse({ error: ERROR_CODES.INVALID_PARAMS });
          return;
        }
        autoLockMinutes = normalizedMinutes;

        await chrome.storage.local.set({
          [STORAGE_KEYS.AUTO_LOCK_MINUTES]: autoLockMinutes,
        });
        lastActivity = Date.now();
        await chrome.storage.local.set({ [STORAGE_KEYS.LAST_ACTIVITY]: lastActivity });
        if (autoLockMinutes === 0) {
          await chrome.alarms.clear(ALARM_NAMES.AUTO_LOCK);
        } else {
          scheduleAlarm();
        }
        sendResponse({ ok: true });
        return;

      case INTERNAL_METHODS.GET_DISPLAY_MODE:
        sendResponse({ mode: await getDisplayMode() });
        return;

      case INTERNAL_METHODS.SET_DISPLAY_MODE: {
        const requestedMode = payload.params?.[0];
        if (requestedMode !== DISPLAY_MODES.POPUP && requestedMode !== DISPLAY_MODES.SIDE_PANEL) {
          sendResponse({ error: ERROR_CODES.INVALID_PARAMS });
          return;
        }

        const resolvedMode =
          requestedMode === DISPLAY_MODES.SIDE_PANEL && chrome.sidePanel
            ? DISPLAY_MODES.SIDE_PANEL
            : DISPLAY_MODES.POPUP;

        await chrome.storage.local.set({ [STORAGE_KEYS.DISPLAY_MODE]: resolvedMode });
        await applyDisplayMode(resolvedMode);
        sendResponse({ success: true, mode: resolvedMode });
        return;
      }

      case INTERNAL_METHODS.GET_PENDING_APPROVAL:
        if (currentRequestId && currentRequestType && pendingRequests.has(currentRequestId)) {
          sendResponse({ requestId: currentRequestId, approvalType: currentRequestType });
        } else {
          sendResponse(null);
        }
        return;

      case INTERNAL_METHODS.UNLOCK:
        const unlockResult = await vault.unlock(payload.params?.[0]); // password
        sendResponse(unlockResult);

        // Emit connect event when unlock succeeds
        if ('ok' in unlockResult && unlockResult.ok) {
          // Clear manual lock flag when successfully unlocked
          manuallyLocked = false;
          await chrome.storage.local.set({ [STORAGE_KEYS.MANUALLY_LOCKED]: false });
          await persistUnlockSession();
          await emitWalletEvent('connect', { chainId: CHAIN_ID });
        }
        return;

      case INTERNAL_METHODS.LOCK:
        // Set manual lock flag - user explicitly locked, don't auto-unlock
        manuallyLocked = true;
        await chrome.storage.local.set({ [STORAGE_KEYS.MANUALLY_LOCKED]: true });
        await vault.lock();
        await clearUnlockSessionCache();
        sendResponse({ ok: true });

        // Emit disconnect event when wallet locks
        await emitWalletEvent('disconnect', { code: 1013, message: 'Wallet locked' });
        return;

      case INTERNAL_METHODS.RESET_WALLET:
        // Reset the wallet completely - clears all data
        await vault.reset();
        await clearUnlockSessionCache();
        subwalletDiscoveryAfterInitialSync.clear();
        subwalletDiscoveryInFlight.clear();
        manuallyLocked = false;
        sendResponse({ ok: true });

        // Emit disconnect event
        await emitWalletEvent('disconnect', { code: 1013, message: 'Wallet reset' });
        return;

      case INTERNAL_METHODS.SETUP:
        // params: password, mnemonic (optional). If no mnemonic, generates one automatically.
        const setupResult = await vault.setup(payload.params?.[0], payload.params?.[1]);

        if ('ok' in setupResult && setupResult.ok) {
          manuallyLocked = false;
        }
        // Respond as soon as setup completes — do not await session/local persistence or discovery.
        sendResponse(setupResult);

        if ('ok' in setupResult && setupResult.ok) {
          void (async () => {
            await chrome.storage.local.set({ [STORAGE_KEYS.MANUALLY_LOCKED]: false });
            await persistUnlockSession();
          })().catch(err => console.error('[Background] Post-SETUP persistence failed:', err));
          // Only scan for existing on-chain sub-wallets when importing a phrase (not brand-new generation).
          const importedExistingPhrase = payload.params?.[2] === true;
          if (importedExistingPhrase) {
            const firstSeedId = vault.getSeedSources()[0]?.id;
            if (firstSeedId) {
              queueSubwalletDiscoveryAfterInitialSync(firstSeedId);
            }
            const currentAccount = vault.getCurrentAccount();
            if (currentAccount) {
              void syncAccountUTXOsWithDedupe(currentAccount.address, currentAccount.name).catch(
                err => console.warn('[Background] Initial imported wallet sync failed:', err)
              );
            }
          }
        }
        return;

      case INTERNAL_METHODS.GET_STATE:
        // Initialize vault state from storage before checking status
        // This ensures hasVault is accurate even after service worker restart
        await vault.init();

        const uiStatus = vault.getUiStatus();
        sendResponse({
          locked: uiStatus.locked,
          hasVault: uiStatus.hasVault,
          address: await vault.getAddressSafe(),
          accounts: vault.getAccounts(),
          currentAccount: vault.getCurrentAccount(),
          activeSeedSourceId: vault.getActiveSeedSourceId(),
        });
        return;

      case INTERNAL_METHODS.GET_ACCOUNTS:
        sendResponse({
          accounts: vault.getAccounts(),
          currentAccount: vault.getCurrentAccount(),
          activeSeedSourceId: vault.getActiveSeedSourceId(),
        });
        return;

      case INTERNAL_METHODS.GET_SEED_SOURCES:
        sendResponse({
          seedSources: vault.getSeedSources(),
        });
        return;

      case INTERNAL_METHODS.SWITCH_ACCOUNT:
        const switchResult = await vault.switchAccount(payload.params?.[0]);
        sendResponse(switchResult);

        // Emit accountsChanged event to all tabs if successful
        if ('ok' in switchResult && switchResult.ok) {
          await emitWalletEvent('accountsChanged', [switchResult.account.address]);
        }
        return;

      case INTERNAL_METHODS.RENAME_ACCOUNT:
        sendResponse(await vault.renameAccount(payload.params?.[0], payload.params?.[1]));
        return;

      case INTERNAL_METHODS.UPDATE_ACCOUNT_STYLING:
        sendResponse(
          await vault.updateAccountStyling(
            payload.params?.[0],
            payload.params?.[1],
            payload.params?.[2]
          )
        );
        return;

      case INTERNAL_METHODS.HIDE_ACCOUNT:
        // params: [accountAddress]
        const hideResult = await vault.hideAccount(payload.params?.[0]);
        sendResponse(hideResult);

        // Emit accountsChanged event to all tabs if successful
        if ('ok' in hideResult && hideResult.ok) {
          const currentAccount = vault.getCurrentAccount();
          if (currentAccount) {
            await emitWalletEvent('accountsChanged', [currentAccount.address]);
          }
        }
        return;

      case INTERNAL_METHODS.CREATE_CHILD_ACCOUNT:
        // params: [seedAccountId, name?]
        const createChildResult = await vault.createChildAccount(
          payload.params?.[0],
          payload.params?.[1]
        );
        sendResponse(createChildResult);
        if (!('error' in createChildResult)) {
          const currentAfterChild = vault.getCurrentAccount();
          if (currentAfterChild) {
            await emitWalletEvent('accountsChanged', [currentAfterChild.address]);
          }
        }
        return;

      case INTERNAL_METHODS.CREATE_MNEMONIC_SEED_SOURCE:
        // params: [mnemonic?, name?]
        const createSeedResult = await vault.createMnemonicSeedSource(
          payload.params?.[0],
          payload.params?.[1]
        );
        // Respond immediately so the popup isn't blocked by long-running discovery.
        sendResponse(createSeedResult);
        if (!('error' in createSeedResult)) {
          const cur = vault.getCurrentAccount();
          await emitWalletEvent('accountsChanged', [
            cur?.address ?? createSeedResult.account.address,
          ]);
          if (payload.params?.[2] === true) {
            queueSubwalletDiscoveryAfterInitialSync(createSeedResult.seedSource.id);
            const curAfterSeed = vault.getCurrentAccount();
            if (curAfterSeed) {
              void syncAccountUTXOsWithDedupe(curAfterSeed.address, curAfterSeed.name).catch(err =>
                console.warn('[Background] Initial seed source sync failed:', err)
              );
            }
          }
        }
        return;

      case INTERNAL_METHODS.CREATE_EXTERNAL_SEED_SOURCE:
        // params: [{ address, name?, provider?, sourceRef?, accountRef? }]
        const createExternalResult = await vault.createExternalSeedSource(
          payload.params?.[0] || {}
        );
        sendResponse(createExternalResult);
        if (!('error' in createExternalResult)) {
          await emitWalletEvent('accountsChanged', [createExternalResult.account.address]);
        }
        return;

      case INTERNAL_METHODS.GET_MNEMONIC:
        // params: password (required for verification)
        sendResponse(await vault.getMnemonic(payload.params?.[0]));
        return;

      case INTERNAL_METHODS.GET_AUTO_LOCK:
        sendResponse({ minutes: autoLockMinutes });
        return;

      case INTERNAL_METHODS.REPORT_ACTIVITY:
        // Just acknowledge - activity tracking already handled above
        sendResponse({ ok: true });
        return;

      case INTERNAL_METHODS.GET_BALANCE_FROM_STORE:
        // Get balance from UTXO store - excludes in-flight notes
        // Optional param: account address. If not provided, uses current account.
        const balanceAccountAddress = payload.params?.[0] || vault.getCurrentAccount()?.address;
        if (!balanceAccountAddress) {
          sendResponse({ error: 'No account selected' });
          return;
        }
        try {
          const storeBalance = await vault.getBalanceFromStore(balanceAccountAddress);
          sendResponse(storeBalance);
        } catch (err) {
          console.error('[Background] Error getting balance from store:', err);
          sendResponse({ error: 'Failed to get balance from store' });
        }
        return;

      case INTERNAL_METHODS.SYNC_UTXOS:
        // Sync UTXOs - runs in background with encrypted Vault.
        // Optional param: account address. If provided, only that account is
        // synced. If omitted, only the currently-selected account is synced
        // (callers can still pass an explicit address to sync a specific one).
        // Guard on lock state: without the encryption key loaded we cannot persist
        // sync results (saveAccountData throws), and iterating accounts while the
        // vault is locked produces a cascade of misleading "Vault is locked" errors.
        if (vault.isLocked()) {
          sendResponse({ error: ERROR_CODES.LOCKED });
          return;
        }

        try {
          const requestedAddress =
            (payload.params?.[0] as string | undefined) || vault.getCurrentAccount()?.address;

          if (!requestedAddress) {
            sendResponse({ ok: true, results: {} });
            return;
          }

          const accounts = vault.getAccounts();
          const account = accounts.find(a => a.address === requestedAddress);
          if (!account) {
            sendResponse({ error: 'Account not found' });
            return;
          }

          // Serialize across concurrent callers for the same account (popup
          // refreshes, multiple screens, initial import sync): a single in-flight
          // sync is reused rather than kicking off parallel passes.
          const syncOutcome = await syncAccountUTXOsWithDedupe(account.address, account.name);
          sendResponse(syncOutcome);
        } catch (err) {
          console.error('[Background] SYNC_UTXOS error:', err);
          sendResponse({ error: 'Failed to sync UTXOs' });
        }
        return;

      case INTERNAL_METHODS.GET_WALLET_TRANSACTIONS:
        // Get wallet transactions for an account from encrypted store
        if (vault.isLocked()) {
          sendResponse({ error: ERROR_CODES.LOCKED });
          return;
        }
        const txAccountAddress = payload.params?.[0];
        if (!txAccountAddress) {
          sendResponse({ error: 'Account address required' });
          return;
        }
        try {
          const transactions = vault.getWalletTransactions(txAccountAddress);
          sendResponse({ ok: true, transactions });
        } catch (err) {
          console.error('[Background] GET_WALLET_TRANSACTIONS error:', err);
          sendResponse({ error: 'Failed to get wallet transactions' });
        }
        return;

      case INTERNAL_METHODS.RECORD_PENDING_V0_MIGRATION:
        if (vault.isLocked()) {
          sendResponse({ error: ERROR_CODES.LOCKED });
          return;
        }
        try {
          const tx = payload.params?.[0] as
            | {
                txId?: string;
                accountAddress?: string;
                amount?: number;
                fee?: number;
                sender?: string;
                recipient?: string;
                priceUsdAtTime?: number;
              }
            | undefined;

          if (!tx?.txId || !tx.accountAddress || !tx.recipient) {
            sendResponse({ error: 'Migration transaction details required' });
            return;
          }

          const account = vault.getAccounts().find(a => a.address === tx.accountAddress);
          if (!account) {
            sendResponse({ error: 'Account not found' });
            return;
          }

          const now = Date.now();
          const walletTx: WalletTransaction = {
            id: tx.txId,
            txHash: tx.txId,
            trackingTxId: tx.txId,
            accountAddress: tx.accountAddress,
            direction: 'incoming',
            createdAt: now,
            updatedAt: now,
            priceUsdAtTime: tx.priceUsdAtTime,
            status: 'broadcasted_unconfirmed',
            origin: 'popup_send',
            recipient: tx.recipient,
            amount: tx.amount,
            fee: tx.fee,
            sender: tx.sender,
            migrationFromV0: true,
            lastMempoolCheckAt: 0,
            lastConfirmationCheckAt: 0,
          };

          await vault.upsertWalletTransaction(walletTx);
          sendResponse({ ok: true, transaction: walletTx });
        } catch (err) {
          console.error('[Background] RECORD_PENDING_V0_MIGRATION error:', err);
          sendResponse({ error: 'Failed to record pending migration transaction' });
        }
        return;

      case INTERNAL_METHODS.GET_CACHED_BALANCES:
        // Get cached balances from encrypted store
        if (vault.isLocked()) {
          sendResponse({ error: ERROR_CODES.LOCKED });
          return;
        }
        try {
          const balances = vault.getCachedBalances();
          sendResponse({ ok: true, balances });
        } catch (err) {
          console.error('[Background] GET_CACHED_BALANCES error:', err);
          sendResponse({ error: 'Failed to get cached balances' });
        }
        return;

      case INTERNAL_METHODS.SET_CACHED_BALANCES:
        // Update cached balances in encrypted store
        if (vault.isLocked()) {
          sendResponse({ error: ERROR_CODES.LOCKED });
          return;
        }
        const balancesToSet = payload.params?.[0] as Record<string, number> | undefined;
        if (!balancesToSet || typeof balancesToSet !== 'object') {
          sendResponse({ error: 'Balances object required' });
          return;
        }
        try {
          await vault.setCachedBalances(balancesToSet);
          sendResponse({ ok: true });
        } catch (err) {
          console.error('[Background] SET_CACHED_BALANCES error:', err);
          sendResponse({ error: 'Failed to set cached balances' });
        }
        return;

      case INTERNAL_METHODS.INITIALIZE_ACCOUNT_UTXOS:
        // Initialize UTXOs for a specific account
        const initAddress = payload.params?.[0];
        if (!initAddress) {
          sendResponse({ error: 'Account address required' });
          return;
        }
        try {
          await vault.initializeAccountUTXOs(initAddress);
          sendResponse({ ok: true });
        } catch (err) {
          console.error('[Background] Error initializing account UTXOs:', err);
          sendResponse({ error: 'Failed to initialize account UTXOs' });
        }
        return;

      case INTERNAL_METHODS.FORCE_RESYNC_ACCOUNT:
        // Force resync a specific account's UTXOs
        const resyncAddress = payload.params?.[0];
        if (!resyncAddress) {
          sendResponse({ error: 'Account address required' });
          return;
        }
        try {
          await vault.forceResyncAccount(resyncAddress);
          sendResponse({ ok: true });
        } catch (err) {
          console.error('[Background] Error resyncing account:', err);
          sendResponse({ error: 'Failed to resync account' });
        }
        return;

      case INTERNAL_METHODS.GET_CONNECTION_STATUS:
        sendResponse({ connected: isRpcConnected });
        return;

      case INTERNAL_METHODS.REPORT_RPC_STATUS:
        // Popup reports actual gRPC call success/failure
        const rpcHealthy = payload.params?.[0] as boolean;
        if (typeof rpcHealthy === 'boolean' && rpcHealthy !== isRpcConnected) {
          isRpcConnected = rpcHealthy;
        }
        sendResponse({ ok: true });
        return;

      // Note: GET_WALLET_TRANSACTIONS is called directly from popup context
      // to avoid service worker limitations with dynamic imports

      // Approval request handlers
      case INTERNAL_METHODS.GET_PENDING_TRANSACTION:
        const getPendingTxId = payload.params?.[0];
        const txPending = pendingRequests.get(getPendingTxId);
        if (txPending && isTransactionRequest(txPending.request)) {
          sendResponse(txPending.request);
        } else {
          sendResponse({ error: ERROR_CODES.NOT_FOUND });
        }
        return;

      case INTERNAL_METHODS.GET_PENDING_SIGN_REQUEST:
        const getPendingSignId = payload.params?.[0];
        const signPending = pendingRequests.get(getPendingSignId);
        if (signPending && isSignRequest(signPending.request)) {
          sendResponse(signPending.request);
        } else {
          sendResponse({ error: ERROR_CODES.NOT_FOUND });
        }
        return;

      case INTERNAL_METHODS.GET_PENDING_SIGN_RAW_TX_REQUEST:
        const getPendingSignRawTxId = payload.params?.[0];
        const signRawTxPending = pendingRequests.get(getPendingSignRawTxId);
        if (signRawTxPending && isSignRawTxRequest(signRawTxPending.request)) {
          sendResponse(signRawTxPending.request);
        } else {
          sendResponse({ error: ERROR_CODES.NOT_FOUND });
        }
        return;

      case INTERNAL_METHODS.APPROVE_TRANSACTION:
        const approveTxId = payload.params?.[0];
        const approveTxPending = pendingRequests.get(approveTxId);
        if (approveTxPending && isTransactionRequest(approveTxPending.request)) {
          const txRequest = approveTxPending.request;

          if (!(await validatePendingApproval(approveTxId, approveTxPending, sendResponse))) {
            return;
          }

          try {
            const feeBuildOptions = resolveTransactionFeeForBuild(
              txRequest.fee,
              txRequest.feeEstimated
            );
            const v2Result = await vault.sendTransactionV2(
              txRequest.to,
              txRequest.amount,
              feeBuildOptions.fee,
              false,
              undefined,
              'provider_send',
              {
                accountAddress: txRequest.accountAddress,
                feeSelectionHint: feeBuildOptions.feeSelectionHint,
              }
            );

            if ('error' in v2Result) {
              throw new Error(v2Result.error);
            }

            approveTxPending.sendResponse({
              txid: v2Result.txId,
              amount: txRequest.amount,
              // Return the actual fee used by WASM, which may differ from the approval estimate.
              fee: String(v2Result.walletTx.fee) as Nicks,
            });
            cancelPendingRequest(approveTxId);
            processNextRequest();
            sendResponse({ success: true });
          } catch (error) {
            console.error('Transaction signing failed:', error);
            approveTxPending.sendResponse({
              error: {
                code: 4900,
                message: error instanceof Error ? error.message : 'Transaction signing failed',
              },
            });
            cancelPendingRequest(approveTxId);
            processNextRequest();
            sendResponse({
              error: error instanceof Error ? error.message : 'Transaction signing failed',
            });
          }
        } else {
          sendResponse({ error: ERROR_CODES.NOT_FOUND });
        }
        return;

      case INTERNAL_METHODS.REJECT_TRANSACTION:
        const rejectTxId = payload.params?.[0];
        const rejectTxPending = pendingRequests.get(rejectTxId);
        if (rejectTxPending) {
          if (rejectTxPending.processing) {
            sendResponse({ error: 'Request is already being processed' });
            return;
          }
          cancelPendingRequest(rejectTxId, 4001, 'User rejected the transaction');
          processNextRequest();
          sendResponse({ success: true });
        } else {
          sendResponse({ error: ERROR_CODES.NOT_FOUND });
        }
        return;

      case INTERNAL_METHODS.APPROVE_SIGN_MESSAGE:
        const approveSignId = payload.params?.[0];
        const approveSignPending = pendingRequests.get(approveSignId);
        if (approveSignPending && isSignRequest(approveSignPending.request)) {
          const signRequest = approveSignPending.request;

          if (!(await validatePendingApproval(approveSignId, approveSignPending, sendResponse))) {
            return;
          }

          try {
            const signMessageResponse = await vault.signMessage(
              [signRequest.message],
              signRequest.accountAddress
            );
            approveSignPending.sendResponse(signMessageResponse);
            cancelPendingRequest(approveSignId);
            processNextRequest();
            sendResponse({ success: true });
          } catch (err) {
            const errorMessage = err instanceof Error ? err.message : 'Failed to sign message';
            cancelPendingRequest(approveSignId, 4001, errorMessage);
            processNextRequest();
            sendResponse({ error: errorMessage });
          }
        } else {
          sendResponse({ error: ERROR_CODES.NOT_FOUND });
        }
        return;

      case INTERNAL_METHODS.REJECT_SIGN_MESSAGE:
        const rejectSignId = payload.params?.[0];
        const rejectSignPending = pendingRequests.get(rejectSignId);
        if (rejectSignPending) {
          if (rejectSignPending.processing) {
            sendResponse({ error: 'Request is already being processed' });
            return;
          }
          cancelPendingRequest(rejectSignId, 4001, 'User rejected the signature request');
          processNextRequest();
          sendResponse({ success: true });
        } else {
          sendResponse({ error: ERROR_CODES.NOT_FOUND });
        }
        return;

      case INTERNAL_METHODS.APPROVE_SIGN_RAW_TX:
        const approveSignRawTxId = payload.params?.[0];
        const approveSignRawTxPending = pendingRequests.get(approveSignRawTxId);

        if (approveSignRawTxPending && isSignRawTxRequest(approveSignRawTxPending.request)) {
          const signRawTxRequest = approveSignRawTxPending.request;

          if (
            !(await validatePendingApproval(
              approveSignRawTxId,
              approveSignRawTxPending,
              sendResponse
            ))
          ) {
            return;
          }

          try {
            assertNativeRawTx(signRawTxRequest.rawTx);
            const currentReview = await vault.describeRawTxForApproval(signRawTxRequest.rawTx);
            if (
              currentReview.transactionId !== signRawTxRequest.transactionId ||
              currentReview.blockHeight !== signRawTxRequest.reviewBlockHeight ||
              currentReview.accountAddress !== signRawTxRequest.accountAddress ||
              (signRawTxRequest.inputsVerified && !currentReview.inputsVerified)
            ) {
              throw new Error('Transaction review changed after approval was requested');
            }

            const signedTx = await vault.signRawTx({
              rawTx: signRawTxRequest.rawTx,
              blockHeight: signRawTxRequest.reviewBlockHeight,
              accountAddress: signRawTxRequest.accountAddress,
            });
            const signedRawTx = wasm.nockchainTxToRawTx(signedTx);
            const signedTransactionId = String(wasm.rawTxId(signedRawTx));
            if (signedTransactionId !== signRawTxRequest.transactionId) {
              throw new Error('Signed transaction does not match the approved transaction');
            }

            approveSignRawTxPending.sendResponse({ tx: signedTx });
            cancelPendingRequest(approveSignRawTxId);
            processNextRequest();
            sendResponse({ success: true });
          } catch (err) {
            console.error('Failed to sign raw transaction:', err);
            const errorMessage =
              err instanceof Error ? err.message : 'Failed to sign raw transaction';
            cancelPendingRequest(approveSignRawTxId, 4001, errorMessage);
            processNextRequest();
            sendResponse({ error: errorMessage });
          }
        } else {
          sendResponse({ error: ERROR_CODES.NOT_FOUND });
        }
        return;

      case INTERNAL_METHODS.REJECT_SIGN_RAW_TX:
        const rejectSignRawTxId = payload.params?.[0];
        const rejectSignRawTxPending = pendingRequests.get(rejectSignRawTxId);
        if (rejectSignRawTxPending) {
          if (rejectSignRawTxPending.processing) {
            sendResponse({ error: 'Request is already being processed' });
            return;
          }
          cancelPendingRequest(rejectSignRawTxId, 4001, 'User rejected the signature request');
          processNextRequest();
          sendResponse({ success: true });
        } else {
          sendResponse({ error: ERROR_CODES.NOT_FOUND });
        }
        return;

      case INTERNAL_METHODS.GET_PENDING_CONNECTION:
        const getPendingConnectId = payload.params?.[0];
        const connectPending = pendingRequests.get(getPendingConnectId);
        if (connectPending && isConnectRequest(connectPending.request)) {
          if (!connectPending.request.accountAddress && !vault.isLocked()) {
            connectPending.request.accountAddress = vault.getAddress();
            void syncPendingApprovalsSession();
          }
          sendResponse(connectPending.request);
        } else {
          sendResponse({ error: ERROR_CODES.NOT_FOUND });
        }
        return;

      case INTERNAL_METHODS.APPROVE_CONNECTION:
        const approveConnectId = payload.params?.[0];
        const approveConnectPending = pendingRequests.get(approveConnectId);
        if (approveConnectPending && isConnectRequest(approveConnectPending.request)) {
          const connectRequest = approveConnectPending.request;

          if (
            !(await validatePendingApproval(approveConnectId, approveConnectPending, sendResponse))
          ) {
            return;
          }

          try {
            const approveRpcConfig = await getEffectiveRpcConfig();
            const connectResponse = buildConnectResponse(
              connectRequest.accountAddress!,
              approveRpcConfig
            );

            // Add origin only after the response can be built.
            await approveOrigin(connectRequest.origin);
            approveConnectPending.sendResponse(connectResponse);
            cancelPendingRequest(approveConnectId);
            processNextRequest();
            sendResponse({ success: true });

            // Emit connect event
            await emitWalletEvent('connect', { chainId: CHAIN_ID });
          } catch (err) {
            console.error('[Background] Failed to approve connection:', err);
            const errorMessage =
              err instanceof Error ? err.message : 'Failed to approve connection';
            cancelPendingRequest(approveConnectId, -32603, errorMessage);
            processNextRequest();
            sendResponse({ error: errorMessage });
          }
        } else {
          sendResponse({ error: ERROR_CODES.NOT_FOUND });
        }
        return;

      case INTERNAL_METHODS.REJECT_CONNECTION:
        const rejectConnectId = payload.params?.[0];
        const rejectConnectPending = pendingRequests.get(rejectConnectId);
        if (rejectConnectPending) {
          if (rejectConnectPending.processing) {
            sendResponse({ error: 'Request is already being processed' });
            return;
          }
          cancelPendingRequest(rejectConnectId, 4001, 'User rejected the connection');
          processNextRequest();
          sendResponse({ success: true });
        } else {
          sendResponse({ error: ERROR_CODES.NOT_FOUND });
        }
        return;

      case INTERNAL_METHODS.GET_PENDING_RAW_TX_REQUEST:
        const getPendingRawTxId = payload.params?.[0];
        const rawTxPending = pendingRequests.get(getPendingRawTxId);

        if (rawTxPending && isSignRawTxRequest(rawTxPending.request)) {
          sendResponse(rawTxPending.request);
        } else {
          sendResponse({ error: ERROR_CODES.NOT_FOUND });
        }
        return;

      case INTERNAL_METHODS.REVOKE_ORIGIN:
        const revokeOriginParam = payload.params?.[0];
        if (
          revokeOriginParam &&
          typeof revokeOriginParam === 'object' &&
          'origin' in revokeOriginParam
        ) {
          await revokeOrigin(revokeOriginParam.origin as string);
          sendResponse({ success: true });
        } else {
          sendResponse({ error: ERROR_CODES.INVALID_PARAMS });
        }
        return;

      case INTERNAL_METHODS.SIGN_TRANSACTION:
        // params: [to, amount, fee]
        // Called from popup Send screen (not dApp transactions)
        if (vault.isLocked()) {
          sendResponse({ error: ERROR_CODES.LOCKED });
          return;
        }

        const [signTo, signAmount, signFee] = payload.params || [];
        if (!isNockAddress(signTo)) {
          sendResponse({ error: ERROR_CODES.BAD_ADDRESS });
          return;
        }
        let signAmountNicks: Nicks;
        let signFeeNicks: Nicks | undefined;
        try {
          signAmountNicks = parseNicksParam(signAmount, 'amount');
          signFeeNicks =
            signFee === undefined || signFee === null
              ? undefined
              : parseNicksParam(signFee, 'fee', { required: false, allowZero: true });
        } catch (err) {
          sendResponse({ error: err instanceof Error ? err.message : 'Invalid params' });
          return;
        }

        try {
          const txid = await vault.signTransaction(signTo, signAmountNicks, signFeeNicks);
          sendResponse({ txid });
        } catch (error) {
          console.error('[Background] Transaction signing failed:', error);
          sendResponse({
            error: error instanceof Error ? error.message : 'Transaction signing failed',
          });
        }
        return;

      case INTERNAL_METHODS.ESTIMATE_SEND_FEE:
        // params: [to, amount] - amount in nicks
        if (vault.isLocked()) {
          sendResponse({ error: ERROR_CODES.LOCKED });
          return;
        }

        const [estimateTo, estimateAmount] = payload.params || [];
        if (!isNockAddress(estimateTo)) {
          sendResponse({ error: ERROR_CODES.BAD_ADDRESS });
          return;
        }
        let estimateAmountNicks: Nicks;
        try {
          estimateAmountNicks = parseNicksParam(estimateAmount, 'amount');
        } catch (err) {
          sendResponse({ error: err instanceof Error ? err.message : 'Invalid params' });
          return;
        }

        try {
          const result = await vault.estimateTransactionFee(estimateTo, estimateAmountNicks);

          if ('error' in result) {
            sendResponse({ error: result.error });
          } else {
            sendResponse({ fee: result.fee });
          }
        } catch (error) {
          console.error('[Background] Fee estimation error:', error);
          sendResponse({
            error: error instanceof Error ? error.message : 'Fee estimation failed',
          });
        }
        return;

      case INTERNAL_METHODS.ESTIMATE_MAX_SEND:
        // params: [to] - estimates max sendable amount for "send max" feature
        if (vault.isLocked()) {
          sendResponse({ error: ERROR_CODES.LOCKED });
          return;
        }

        const [maxSendTo] = payload.params || [];
        if (!isNockAddress(maxSendTo)) {
          sendResponse({ error: ERROR_CODES.BAD_ADDRESS });
          return;
        }

        try {
          const maxResult = await vault.estimateMaxSendAmount(maxSendTo);

          if ('error' in maxResult) {
            sendResponse({ error: maxResult.error });
          } else {
            sendResponse({
              maxAmount: maxResult.maxAmount,
              fee: maxResult.fee,
              totalAvailable: maxResult.totalAvailable,
              utxoCount: maxResult.utxoCount,
            });
          }
        } catch (error) {
          console.error('[Background] Max send estimation error:', error);
          sendResponse({
            error: error instanceof Error ? error.message : 'Max send estimation failed',
          });
        }
        return;

      case INTERNAL_METHODS.SEND_TRANSACTION_V2:
        // params: [to, amount, fee?, sendMax?, priceUsdAtTime?] - amount and fee in nicks
        // Uses UTXO store for proper note locking and successive transaction support
        // sendMax: if true, uses all available UTXOs and sets refundPKH = recipient for sweep
        // priceUsdAtTime: USD price per NOCK at time of transaction (for historical display)
        if (vault.isLocked()) {
          sendResponse({ error: ERROR_CODES.LOCKED });
          return;
        }

        const [sendToV2, sendAmountV2, sendFeeV2, sendMaxV2, priceUsdAtTimeV2] =
          payload.params || [];
        if (!isNockAddress(sendToV2)) {
          sendResponse({ error: ERROR_CODES.BAD_ADDRESS });
          return;
        }
        let amountV2Nicks: Nicks;
        let feeV2Nicks: Nicks | undefined;
        try {
          amountV2Nicks = parseNicksParam(sendAmountV2, 'amount');
          feeV2Nicks =
            sendFeeV2 === undefined || sendFeeV2 === null
              ? undefined
              : parseNicksParam(sendFeeV2, 'fee', { required: false, allowZero: true });
        } catch (err) {
          sendResponse({ error: err instanceof Error ? err.message : 'Invalid params' });
          return;
        }

        try {
          const v2Result = await vault.sendTransactionV2(
            sendToV2,
            amountV2Nicks,
            feeV2Nicks,
            sendMaxV2, // optional, sweep all UTXOs to recipient
            priceUsdAtTimeV2, // optional, USD price at time of tx
            'popup_send'
          );

          if ('error' in v2Result) {
            sendResponse({ error: v2Result.error });
            return;
          }

          sendResponse({
            txid: v2Result.txId,
            broadcasted: v2Result.broadcasted,
            walletTx: v2Result.walletTx,
          });
        } catch (error) {
          console.error('[Background] SendTransactionV2 failed:', error);
          sendResponse({
            error: error instanceof Error ? error.message : 'Transaction failed',
          });
        }
        return;

      case INTERNAL_METHODS.ESTIMATE_BRIDGE_FEE:
        // params: [destinationAddress, amountNicks]
        if (vault.isLocked()) {
          sendResponse({ error: ERROR_CODES.LOCKED });
          return;
        }

        const [estimateBridgeDest, estimateBridgeAmountNicks] = payload.params || [];
        if (!estimateBridgeDest || !isEvmAddress(estimateBridgeDest)) {
          sendResponse({ error: 'Invalid destination address. Expected EVM address (0x...).' });
          return;
        }
        let estimateBridgeAmountParsed: Nicks;
        try {
          estimateBridgeAmountParsed = parseNicksParam(estimateBridgeAmountNicks, 'amount');
        } catch (err) {
          sendResponse({ error: err instanceof Error ? err.message : 'Invalid amount' });
          return;
        }

        try {
          const estimateResult = await vault.estimateBridgeFee(
            estimateBridgeDest,
            estimateBridgeAmountParsed
          );

          if ('error' in estimateResult) {
            sendResponse({ error: estimateResult.error });
            return;
          }

          sendResponse({ fee: estimateResult.fee });
        } catch (error) {
          console.error('[Background] Bridge fee estimation failed:', error);
          sendResponse({
            error: error instanceof Error ? error.message : 'Bridge fee estimation failed',
          });
        }
        return;

      case INTERNAL_METHODS.ESTIMATE_MAX_BRIDGE:
        // params: [destinationAddress] - estimates max bridge amount after reserving network fee
        if (vault.isLocked()) {
          sendResponse({ error: ERROR_CODES.LOCKED });
          return;
        }

        const [maxBridgeDest] = payload.params || [];
        if (!maxBridgeDest || !isEvmAddress(maxBridgeDest)) {
          sendResponse({ error: 'Invalid destination address. Expected EVM address (0x...).' });
          return;
        }

        try {
          const maxBridgeResult = await vault.estimateMaxBridgeAmount(maxBridgeDest);

          if ('error' in maxBridgeResult) {
            sendResponse({ error: maxBridgeResult.error });
            return;
          }

          sendResponse({
            maxAmount: maxBridgeResult.maxAmount,
            fee: maxBridgeResult.fee,
            totalAvailable: maxBridgeResult.totalAvailable,
            utxoCount: maxBridgeResult.utxoCount,
          });
        } catch (error) {
          console.error('[Background] Max bridge estimation failed:', error);
          sendResponse({
            error: error instanceof Error ? error.message : 'Max bridge estimation failed',
          });
        }
        return;

      case INTERNAL_METHODS.SEND_BRIDGE_TRANSACTION:
        // params: [destinationAddress, amountNicks, priceUsdAtTime?]
        // EVM address (Base), amount in nicks
        if (vault.isLocked()) {
          sendResponse({ error: ERROR_CODES.LOCKED });
          return;
        }

        const [bridgeDest, bridgeAmountNicks, bridgePriceUsd] = payload.params || [];
        if (!bridgeDest || !isEvmAddress(bridgeDest)) {
          sendResponse({ error: 'Invalid destination address. Expected EVM address (0x...).' });
          return;
        }
        let bridgeAmountNicksParsed: Nicks;
        try {
          bridgeAmountNicksParsed = parseNicksParam(bridgeAmountNicks, 'amount');
        } catch (err) {
          sendResponse({ error: err instanceof Error ? err.message : 'Invalid amount' });
          return;
        }

        try {
          const bridgeResult = await vault.sendBridgeTransaction(
            bridgeDest,
            bridgeAmountNicksParsed,
            typeof bridgePriceUsd === 'number' ? bridgePriceUsd : undefined
          );

          if ('error' in bridgeResult) {
            sendResponse({ error: bridgeResult.error });
            return;
          }

          sendResponse({
            txid: bridgeResult.txId,
            broadcasted: bridgeResult.broadcasted,
            walletTx: bridgeResult.walletTx,
          });
        } catch (error) {
          console.error('[Background] Bridge transaction failed:', error);
          sendResponse({
            error: error instanceof Error ? error.message : 'Bridge transaction failed',
          });
        }
        return;

      case INTERNAL_METHODS.SEND_TRANSACTION:
        // params: [to, amount, fee] - amount and fee in nicks
        // Called from popup Send screen - builds, signs, and broadcasts transaction
        if (vault.isLocked()) {
          sendResponse({ error: ERROR_CODES.LOCKED });
          return;
        }

        const [sendTo, sendAmount, sendFee] = payload.params || [];
        if (!isNockAddress(sendTo)) {
          sendResponse({ error: ERROR_CODES.BAD_ADDRESS });
          return;
        }
        let sendAmountNicks: Nicks;
        let sendFeeNicks: Nicks;
        try {
          sendAmountNicks = parseNicksParam(sendAmount, 'amount');
          sendFeeNicks = parseNicksParam(sendFee, 'fee', { allowZero: true });
        } catch (err) {
          sendResponse({ error: err instanceof Error ? err.message : 'Invalid params' });
          return;
        }

        try {
          const result = await vault.sendTransaction(sendTo, sendAmountNicks, sendFeeNicks);

          if ('error' in result) {
            sendResponse({ error: result.error });
            return;
          }

          sendResponse({
            txid: result.txId,
            broadcasted: result.broadcasted,
            protobufTx: result.protobufTx, // For dev/debugging - export to file
          });
        } catch (error) {
          console.error('[Background] Transaction sending failed:', error);
          sendResponse({
            error: error instanceof Error ? error.message : 'Transaction sending failed',
          });
        }
        return;

      default:
        sendResponse({ error: ERROR_CODES.METHOD_NOT_SUPPORTED });
        return;
    }
  })();
  // Required: tells Chrome we'll call sendResponse asynchronously from the IIFE
  return true;
});

/**
 * Handle auto-lock alarm
 */
chrome.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name !== ALARM_NAMES.AUTO_LOCK) return;

  await initPromise;
  await ensureSessionRestored();

  // Zero is the explicit "Never" preference.
  if (autoLockMinutes <= 0) {
    chrome.alarms.clear(ALARM_NAMES.AUTO_LOCK);
    return;
  }

  // Don't auto-lock if user manually locked - respect their choice
  if (manuallyLocked) {
    return;
  }

  const idleMs = Date.now() - lastActivity;
  if (idleMs >= autoLockMinutes * 60_000) {
    try {
      await vault.lock();
      await clearUnlockSessionCache();
      // Notify popup to update UI immediately
      await emitWalletEvent('LOCKED', { reason: 'auto-lock' });
    } catch (error) {
      console.error('Auto-lock failed:', error);
    }
  }
});

/**
 * Schedule the auto-lock alarm (runs every minute)
 */
function scheduleAlarm() {
  chrome.alarms.create(ALARM_NAMES.AUTO_LOCK, {
    delayInMinutes: 1,
    periodInMinutes: 1,
  });
}
