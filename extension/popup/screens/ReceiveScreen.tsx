import { useState } from 'react';
import { useStore } from '../store';
import IrisLogo40 from '../assets/iris-logo-40.svg';
import { ChevronLeftIcon } from '../components/icons/ChevronLeftIcon';

export function ReceiveScreen() {
  const { navigate, wallet } = useStore();
  const [copySuccess, setCopySuccess] = useState(false);

  // Get address from current account
  const address = wallet.currentAccount?.address || wallet.address || '';
  const addressStart = address.slice(0, 6);
  const addressMiddle = address.slice(6, -5);
  const addressEnd = address.slice(-5);

  function handleBack() {
    navigate('home');
  }

  async function handleCopyAddress() {
    try {
      await navigator.clipboard.writeText(address);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch (err) {
      console.error('Failed to copy address:', err);
    }
  }

  return (
    <div
      className="w-full h-full flex flex-col overflow-y-auto"
      style={{ backgroundColor: 'var(--color-bg)', color: 'var(--color-text-primary)' }}
    >
      {/* Header */}
      <header
        className="flex items-center justify-between px-4 py-3 min-h-[64px]"
        style={{ backgroundColor: 'var(--color-bg)' }}
      >
        <button
          type="button"
          onClick={handleBack}
          aria-label="Back"
          className="w-8 h-8 p-2 flex items-center justify-center rounded-lg transition-colors focus:outline-none focus-visible:ring-2"
          style={{ backgroundColor: 'transparent' }}
          onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--color-surface-800)')}
          onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
        >
          <ChevronLeftIcon className="w-5 h-5" />
        </button>
        <h1 className="m-0 text-base font-medium leading-[22px] tracking-[0.16px]">Receive NOCK</h1>
        <div className="w-8 h-8" />
      </header>

      {/* Content */}
      <div className="flex flex-col gap-2 flex-1 min-h-0" style={{ backgroundColor: 'var(--color-bg)' }}>
        <div className="flex flex-col gap-8 px-4 py-2">
          {/* Intro */}
          <div className="flex flex-col items-center gap-3 w-full">
            <img src={IrisLogo40} alt="Iris" className="w-10 h-10" />

            <h2
              className="m-0 text-2xl font-medium leading-7 tracking-[-0.48px] text-center font-display"
              style={{ color: 'var(--color-text-primary)' }}
            >
              Your address
            </h2>
          </div>

          {/* Address + Copy */}
          <div className="flex flex-col gap-4 w-full">
            <div
              className="rounded-lg px-3 pt-5 pb-3 flex flex-col items-center gap-5"
              style={{ backgroundColor: 'var(--color-surface-800)' }}
            >
              <div className="text-sm leading-[18px] tracking-[0.14px] font-medium text-center break-words">
                <span style={{ color: 'var(--color-text-primary)' }}>{addressStart}</span>
                <span style={{ color: 'var(--color-text-muted)' }}>
                  {addressMiddle.substring(0, 18)}
                </span>
                <br />
                <span style={{ color: 'var(--color-text-muted)' }}>
                  {addressMiddle.substring(18)}
                </span>
                <span style={{ color: 'var(--color-text-primary)' }}>{addressEnd}</span>
              </div>

              <button
                type="button"
                onClick={handleCopyAddress}
                className="inline-flex items-center justify-center gap-[6px] py-[7px] pr-3 pl-4 bg-transparent rounded-full text-sm font-medium leading-[18px] tracking-[0.14px] transition active:opacity-80 focus:outline-none focus-visible:ring-2"
                style={{
                  border: '1px solid var(--color-text-primary)',
                  color: 'var(--color-text-primary)',
                }}
                onMouseEnter={e =>
                  (e.currentTarget.style.backgroundColor = 'var(--color-surface-700)')
                }
                onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  className="shrink-0"
                >
                  <path
                    d="M10.6667 1.33334H2.66667C1.93334 1.33334 1.34 1.93334 1.34 2.66667L1.33334 11.3333C1.33334 12.0667 1.92667 12.6667 2.66 12.6667H10.6667C11.4 12.6667 12 12.0667 12 11.3333V2.66667C12 1.93334 11.4 1.33334 10.6667 1.33334ZM10.6667 11.3333H2.66667V2.66667H10.6667V11.3333ZM13.3333 5.33334V14C13.3333 14.7333 12.7333 15.3333 12 15.3333H4.66667C4.66667 15.3333 4.66667 14.6667 4.66667 14.6667H12.6667V5.33334C12.6667 5.33334 13.3333 5.33334 13.3333 5.33334Z"
                    fill="currentColor"
                  />
                </svg>
                {copySuccess ? 'Copied!' : 'Copy address'}
              </button>
            </div>

            {/* Instructions */}
            <div
              className="rounded-lg p-3 flex flex-col gap-2.5"
              style={{ border: '1px solid var(--color-divider)' }}
            >
              <h3
                className="m-0 text-sm font-medium leading-[18px] tracking-[0.14px] font-display"
                style={{ color: 'var(--color-text-primary)' }}
              >
                How to receive NOCK:
              </h3>
              <ul className="m-0 p-0 flex flex-col">
                <li
                  className="text-[13px] leading-[18px] tracking-[0.26px] font-medium relative pl-0 before:content-['•'] before:mr-1 before:inline-block"
                  style={{ color: 'var(--color-text-primary)' }}
                >
                  Share this address with the sender
                </li>
                <li
                  className="text-[13px] leading-[18px] tracking-[0.26px] font-medium relative pl-0 before:content-['•'] before:mr-1 before:inline-block"
                  style={{ color: 'var(--color-text-primary)' }}
                >
                  Transactions will appear in your wallet
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
