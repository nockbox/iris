/**
 * Inpage Provider: Injected into web pages
 * Exposes window.nockchain with EIP-1193-style API
 *
 * NOTE: This file runs in the MAIN world and cannot use any imports or Chrome APIs
 */

import { InjectedNockchain, RpcRequest, RPC_API_VERSION } from '@nockbox/iris-sdk';
import { version } from '../../package.json';

// Inline constant to avoid imports
const MESSAGE_TARGET = 'IRIS';

class NockProvider implements InjectedNockchain {
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
            reject(new Error(data.reply.error));
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
(provider as InjectedNockchain).api = RPC_API_VERSION;
(window as any).nockchain = provider;

// Announce provider availability
window.dispatchEvent(new Event('nockchain#initialized'));
