/**
 * Inpage Provider: Injected into web pages
 * Exposes window.nockchain with EIP-1193-style API
 *
 * NOTE: This file runs in the MAIN world and cannot use any imports or Chrome APIs
 */

// Inline constant to avoid imports
const MESSAGE_TARGET = 'FORT_NOCK';

interface RequestArgs {
  method: string;
  params?: unknown[];
}

class NockProvider {
  /**
   * Make a request to the wallet
   * @param args - Request arguments with method and params
   */
  request(args: RequestArgs): Promise<unknown> {
    const id = Math.random().toString(36).slice(2);

    console.log('[Fort Nock] Sending request:', args.method, { id, args });

    // Post message to content script
    window.postMessage(
      {
        target: MESSAGE_TARGET,
        id,
        payload: args
      },
      '*'
    );

    // Wait for response
    return new Promise((resolve, reject) => {
      const handler = (evt: MessageEvent) => {
        const data = evt.data;

        // Check if this is our response (must have a reply field, not just the request)
        if (data?.target === MESSAGE_TARGET && data.id === id && data.reply !== undefined) {
          console.log('[Fort Nock] Matched response:', { id, reply: data.reply, fullData: data });
          window.removeEventListener('message', handler);

          if (data.reply?.error) {
            reject(new Error(data.reply.error));
          } else {
            resolve(data.reply);
          }
        }
      };

      window.addEventListener('message', handler);
    });
  }

  /**
   * Event listener stub (for EIP-1193 compatibility)
   */
  on(_eventName: string, _listener: (...args: unknown[]) => void): void {
    // TODO: Implement event system if needed
  }

  /**
   * Remove event listener stub (for EIP-1193 compatibility)
   */
  removeListener(_eventName: string, _listener: (...args: unknown[]) => void): void {
    // TODO: Implement event system if needed
  }
}

// Inject provider into window
const provider = new NockProvider();
(provider as any).isFortNock = true;
(window as any).nockchain = provider;

// Announce provider availability
window.dispatchEvent(new Event('nockchain#initialized'));
