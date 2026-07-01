/**
 * Inpage Provider: Injected into web pages
 * Exposes window.nockchain with EIP-1193-style API
 *
 * NOTE: This file runs in the MAIN world and cannot use any imports or Chrome APIs
 */

import { InjectedNockchain, RpcRequest } from '@nockbox/iris-sdk';
import { version } from '../../package.json';

// Inline constant to avoid imports
const MESSAGE_TARGET = 'IRIS';

function readableErrorMessage(error: unknown): string {
  if (!error) return 'Wallet request failed without a response';
  if (typeof error === 'string') {
    const text = error.trim();
    return text && text !== '[object Object]' ? text : 'Wallet request failed';
  }
  if (typeof error !== 'object') return String(error);

  const value = error as Record<string, unknown>;
  for (const key of ['message', 'reason', 'details']) {
    const detail = value[key];
    if (typeof detail === 'string' && detail.trim() && detail !== '[object Object]') {
      return detail;
    }
  }
  for (const key of ['error', 'data', 'cause']) {
    const detail = readableErrorMessage(value[key]);
    if (detail && detail !== 'Wallet request failed without a response') {
      return detail;
    }
  }

  try {
    const serialized = JSON.stringify(error);
    if (serialized && serialized !== '{}') return serialized;
  } catch {
    // ignore serialization failures
  }
  return 'Wallet request failed';
}

class NockProvider implements InjectedNockchain {
  version = version;
  provider = 'iris';

  /**
   * Make a request to the wallet
   * @param args - Request arguments with method and params
   */
  request<T = unknown>(args: RpcRequest): Promise<T> {
    const id = Math.random().toString(36).slice(2);

    // Post message to content script
    window.postMessage(
      {
        target: MESSAGE_TARGET,
        id,
        payload: args,
      },
      '*'
    );

    // Wait for response with timeout
    return new Promise((resolve, reject) => {
      let timeoutId: number | undefined;

      const handler = (evt: MessageEvent) => {
        const data = evt.data;

        // Check if this is our response (must have a reply field, not just the request)
        if (data?.target === MESSAGE_TARGET && data.id === id && data.reply !== undefined) {
          window.removeEventListener('message', handler);
          if (timeoutId) {
            clearTimeout(timeoutId);
          }

          if (data.reply?.error) {
            const error = data.reply.error;
            const message = readableErrorMessage(error);
            const wrapped = new Error(message);
            (wrapped as Error & { originalError?: unknown }).originalError = error;
            if (error && typeof error === 'object') {
              Object.assign(wrapped, error);
            }
            reject(wrapped);
          } else {
            resolve(data.reply);
          }
        }
      };

      if (args.timeout) {
        timeoutId = window.setTimeout(() => {
          window.removeEventListener('message', handler);
          reject(
            new Error(
              'Extension is not responding.' +
                'If you just reloaded the extension, you need to refresh this page.'
            )
          );
        }, args.timeout);
      }
      window.addEventListener('message', handler);
    });
  }

  debug() {
    return {
      provider: 'iris',
      version,
      injected: true,
      location: window.location.origin,
    };
  }
}

// Inject provider into window
const provider = new NockProvider();
(window as any).nockchain = provider;

// Announce provider availability
window.dispatchEvent(new Event('nockchain#initialized'));
