/**
 * Receive Screen - Display address for receiving NOCK
 */

import { useStore } from '../../store';
import { ScreenContainer } from '../../components/ScreenContainer';
import { ChevronLeftIcon } from '../../components/icons/ChevronLeftIcon';
import { CopyIcon } from '../../components/icons/CopyIcon';
import { useCopyToClipboard } from '../../hooks/useCopyToClipboard';

export function ReceiveScreen() {
  const { navigate, wallet } = useStore();
  const { copied, copyToClipboard } = useCopyToClipboard();

  const address = wallet.currentAccount?.address || '';

  return (
    <ScreenContainer className="flex flex-col">
      {/* Header with back button */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate('home')}
          className="text-gray-400 hover:text-white transition-colors"
        >
          <ChevronLeftIcon />
        </button>
        <h2 className="text-xl font-semibold">Receive NOCK</h2>
      </div>

      {/* Address section */}
      <div className="mb-6">
        <h3 className="text-center text-gray-300 mb-4">Your Address</h3>
        <div className="bg-gray-800 rounded-lg p-4 mb-4">
          <p className="text-sm font-mono break-all text-gray-200">{address}</p>
        </div>

        {/* Copy button */}
        <button
          onClick={() => copyToClipboard(address)}
          className="w-full bg-yellow-500 hover:bg-yellow-600 text-black font-semibold py-3 px-4 rounded-lg transition-colors flex items-center justify-center gap-2"
        >
          <CopyIcon />
          {copied ? 'Copied!' : 'Copy Address'}
        </button>
      </div>

      {/* Instructions */}
      <div className="bg-gray-900 rounded-lg p-4 mb-6">
        <h4 className="text-sm font-semibold mb-2">How to receive NOCK:</h4>
        <ul className="text-sm text-gray-400 space-y-1">
          <li>• Share this address with the sender</li>
          <li>• Transactions will appear in your wallet</li>
        </ul>
      </div>

      {/* Done button */}
      <button
        onClick={() => navigate('home')}
        className="w-full btn-secondary mt-auto"
      >
        Done
      </button>
    </ScreenContainer>
  );
}
