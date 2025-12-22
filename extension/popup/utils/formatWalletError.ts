import { ERROR_CODES } from '../../shared/constants';

type RpcErrorObject = {
  code?: unknown;
  message?: unknown;
};

/**
 * Convert mixed backend error shapes into a user-friendly message.
 *
 * The background sometimes returns a string error code (e.g. ERROR_CODES.LOCKED)
 * and sometimes returns an object like { code: -32602, message: 'Invalid params' }.
 */
export function formatWalletError(err: unknown): string {
  // Common JS errors
  if (err instanceof Error) return err.message || 'Unknown error';

  // Background often returns string error codes
  if (typeof err === 'string') {
    if (err === ERROR_CODES.BAD_PASSWORD) return 'Incorrect password';
    if (err === ERROR_CODES.LOCKED) return 'Wallet is locked. Unlock Iris to continue.';
    if (err === ERROR_CODES.UNAUTHORIZED) return 'Unauthorized';
    if (err === ERROR_CODES.INVALID_PARAMS) return 'Invalid parameters';
    return `Error: ${err}`;
  }

  // JSON-RPC style errors: { code, message }
  if (typeof err === 'object' && err !== null) {
    const e = err as RpcErrorObject;
    if (typeof e.message === 'string' && e.message.trim().length > 0) return e.message;
    if (typeof e.code === 'string' || typeof e.code === 'number') return `Error: ${e.code}`;
  }

  // Fallback
  return 'Unknown error';
}
