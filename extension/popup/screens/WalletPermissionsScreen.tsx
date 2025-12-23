import { useStore } from '../store';
import { useState, useEffect } from 'react';
import { STORAGE_KEYS, INTERNAL_METHODS } from '../../shared/constants';
import { send } from '../utils/messaging';
import IrisLogo from '../assets/iris-logo.svg';
import { CloseIcon } from '../components/icons/CloseIcon';

export function WalletPermissionsScreen() {
  const { navigate } = useStore();
  const [approvedOrigins, setApprovedOrigins] = useState<string[]>([]);

  useEffect(() => {
    loadApprovedOrigins();
  }, []);

  async function loadApprovedOrigins() {
    const stored = (await chrome.storage.local.get([STORAGE_KEYS.APPROVED_ORIGINS])) as Record<
      string,
      unknown
    >;
    const raw = stored[STORAGE_KEYS.APPROVED_ORIGINS];
    const origins = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
    setApprovedOrigins(origins);
  }

  function handleClose() {
    navigate('home');
  }

  async function handleRevoke(origin: string) {
    try {
      await send(INTERNAL_METHODS.REVOKE_ORIGIN, [{ origin }]);
      await loadApprovedOrigins();
    } catch (error) {
      console.error('Failed to revoke origin:', error);
    }
  }

  return (
    <div
      className="w-[357px] h-[600px] flex flex-col overflow-y-auto"
      style={{ backgroundColor: 'var(--color-bg)', color: 'var(--color-text-primary)' }}
    >
      {/* Header */}
      <header
        className="flex items-center justify-between px-4 py-3 min-h-[64px]"
        style={{ backgroundColor: 'var(--color-bg)' }}
      >
        <div className="w-8 h-8 flex items-center justify-center shrink-0">
          <img src={IrisLogo} alt="Iris" className="w-6 h-6" />
        </div>
        <h1 className="m-0 text-base font-medium leading-[22px] tracking-[0.16px]">
          Wallet permissions
        </h1>
        <button
          type="button"
          onClick={handleClose}
          className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors focus:outline-none focus-visible:ring-2 shrink-0"
          style={{ color: 'var(--color-text-primary)' }}
          onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--color-surface-800)')}
          onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
          aria-label="Close"
        >
          <CloseIcon />
        </button>
      </header>

      {/* Content */}
      <div className="flex flex-col gap-2 h-[536px] overflow-y-auto">
        <div className="flex flex-col gap-2 px-4 py-2">
          {approvedOrigins && approvedOrigins.length > 0 ? (
            approvedOrigins.map(origin => (
              <div
                key={origin}
                className="flex items-center justify-between p-2 rounded-lg transition-colors"
                onMouseEnter={e =>
                  (e.currentTarget.style.backgroundColor = 'var(--color-surface-800)')
                }
                onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
              >
                <div className="flex items-center gap-2.5 flex-1 min-w-0">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center overflow-hidden shrink-0">
                    {/* Site icon placeholder (first letter) */}
                    <div
                      className="w-5 h-5 flex items-center justify-center text-[12px] font-semibold"
                      style={{ color: 'var(--color-text-muted)' }}
                    >
                      {origin.charAt(0).toUpperCase()}
                    </div>
                  </div>
                  <span className="text-sm font-medium leading-[18px] tracking-[0.14px] truncate">
                    {origin}
                  </span>
                </div>

                <button
                  type="button"
                  title="Revoke permissions"
                  onClick={() => handleRevoke(origin)}
                  className="w-8 h-8 rounded-lg flex items-center justify-center p-1.5 transition-colors focus:outline-none focus-visible:ring-2 shrink-0"
                  style={{ backgroundColor: 'var(--color-red-light)' }}
                  onMouseEnter={e => (e.currentTarget.style.opacity = '0.8')}
                  onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
                >
                  <CloseIcon className="w-4 h-4 [filter:brightness(0)_saturate(100%)_invert(29%)_sepia(96%)_saturate(2447%)_hue-rotate(347deg)_brightness(92%)_contrast(93%)]" />
                </button>
              </div>
            ))
          ) : (
            <div className="flex items-center justify-center text-center px-4 py-10">
              <p
                className="m-0 text-sm font-normal leading-[18px] tracking-[0.14px]"
                style={{ color: 'var(--color-text-muted)' }}
              >
                No connected sites
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
