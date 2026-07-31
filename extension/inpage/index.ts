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

class NockProvider implements InjectedNockchain {
  /**
   * Make a request to the wallet
   * @param args - Request arguments with method and params
   */
  request<T = unknown>(args: RpcRequest): Promise<T> {
    const id = crypto.randomUUID();

    // Post message to content script
    window.postMessage(
      {
        target: MESSAGE_TARGET,
        id,
        payload: args,
      },
      window.location.origin
    );

    // Wait for response with timeout
    return new Promise((resolve, reject) => {
      let timeoutId: number | undefined;

      const handler = (evt: MessageEvent) => {
        const data = evt.data;

        // Check if this is our response (must have a reply field, not just the request)
        if (
          evt.source === window &&
          data &&
          typeof data === 'object' &&
          data.target === MESSAGE_TARGET &&
          data.id === id &&
          Object.prototype.hasOwnProperty.call(data, 'reply')
        ) {
          window.removeEventListener('message', handler);
          if (timeoutId) {
            clearTimeout(timeoutId);
          }

          if (data.reply?.error) {
            const message =
              typeof data.reply.error === 'string'
                ? data.reply.error
                : typeof data.reply.error?.message === 'string'
                  ? data.reply.error.message
                  : 'Wallet request failed';
            reject(new Error(message));
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
}

// Inject provider into window
const provider = new NockProvider();
(provider as InjectedNockchain).provider = 'iris';
(provider as InjectedNockchain).version = version;
(window as any).nockchain = provider;

// Announce provider availability
window.dispatchEvent(new Event('nockchain#initialized'));
