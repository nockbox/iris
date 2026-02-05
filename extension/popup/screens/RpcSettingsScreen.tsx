import { useState, useEffect, useRef } from 'react';
import { useStore } from '../store';
import { useClickOutside } from '../hooks/useClickOutside';
import { ChevronLeftIcon } from '../components/icons/ChevronLeftIcon';
import { ChevronDownIcon } from '../components/icons/ChevronDownIcon';
import NockBlocksFrame from '../assets/NockBlocksFrame.svg';
import NockScanFrame from '../assets/NockScanFrame.svg';
import {
  defaultRpcConfig,
  getEffectiveRpcConfig,
  saveRpcConfig,
  clearRpcConfig,
  BLOCK_EXPLORER_OPTIONS,
  NOCKSCAN_URL,
  NOCKBLOCKS_URL,
} from '../../shared/rpc-config';

const BLOCK_EXPLORER_ICONS: Record<string, string> = {
  [NOCKSCAN_URL]: NockScanFrame,
  [NOCKBLOCKS_URL]: NockBlocksFrame,
};

export function RpcSettingsScreen() {
  const { navigate, refreshRpcDisplayConfig } = useStore();
  const [networkName, setNetworkName] = useState(defaultRpcConfig.networkName);
  const [rpcUrl, setRpcUrl] = useState(defaultRpcConfig.rpcUrl);
  const [blockExplorerUrl, setBlockExplorerUrl] = useState(defaultRpcConfig.blockExplorerUrl);
  const [explorerOpen, setExplorerOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const explorerRef = useRef<HTMLDivElement>(null);

  useClickOutside(explorerRef, () => setExplorerOpen(false), explorerOpen);

  useEffect(() => {
    getEffectiveRpcConfig().then(config => {
      setNetworkName(config.networkName);
      // Strip only https for form display so http URLs are preserved (ensureHttps leaves http as-is)
      const displayRpcUrl = config.rpcUrl.replace(/^https:\/\//i, '');
      setRpcUrl(displayRpcUrl);
      const explorerUrl = BLOCK_EXPLORER_OPTIONS.some(o => o.value === config.blockExplorerUrl)
        ? config.blockExplorerUrl
        : defaultRpcConfig.blockExplorerUrl;
      setBlockExplorerUrl(explorerUrl);
      setIsLoading(false);
    });
  }, []);

  function handleBack() {
    navigate('settings');
  }

  async function handleSave() {
    setSaveStatus('saving');
    try {
      await saveRpcConfig({
        networkName,
        rpcUrl: rpcUrl.trim(),
        blockExplorerUrl,
      });
      await refreshRpcDisplayConfig();
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch {
      setSaveStatus('idle');
    }
  }

  async function handleResetToDefault() {
    setNetworkName(defaultRpcConfig.networkName);
    setRpcUrl(defaultRpcConfig.rpcUrl);
    setBlockExplorerUrl(defaultRpcConfig.blockExplorerUrl);
    await clearRpcConfig();
  }

  const inputClass =
    'w-full h-[52px] bg-transparent rounded-lg px-3 py-4 outline-none transition-colors text-sm leading-[18px] tracking-[0.14px] font-medium';
  const inputStyle = {
    border: '1px solid var(--color-surface-700)',
    color: 'var(--color-text-primary)',
  };
  const labelClass = 'text-[13px] leading-[18px] tracking-[0.26px] font-medium';
  const labelStyle = { color: 'var(--color-text-muted)' };

  return (
    <div
      className="w-[357px] h-[600px] flex flex-col overflow-y-auto"
      style={{ backgroundColor: 'var(--color-bg)', color: 'var(--color-text-primary)' }}
    >
      {/* Header */}
      <header
        className="flex items-center justify-between px-4 py-3 min-h-[64px] shrink-0"
        style={{ backgroundColor: 'var(--color-bg)' }}
      >
        <button
          type="button"
          onClick={handleBack}
          aria-label="Back"
          className="w-8 h-8 p-2 flex items-center justify-center rounded-lg transition-colors focus:outline-none focus-visible:ring-2"
          style={{ color: 'var(--color-text-primary)' }}
          onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--color-surface-800)')}
          onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
        >
          <ChevronLeftIcon className="w-5 h-5" />
        </button>
        <h1 className="m-0 text-base font-medium leading-[22px] tracking-[0.16px]">RPC settings</h1>
        <div className="w-8 h-8" />
      </header>

      {/* Form */}
      <div className="flex flex-col flex-1 px-4 py-4 gap-4 overflow-y-auto">
        <div className="flex flex-col gap-[6px]">
          <label className={labelClass} style={labelStyle}>
            Network name
          </label>
          <input
            type="text"
            className={inputClass}
            style={inputStyle}
            value={networkName}
            onChange={e => setNetworkName(e.target.value)}
            onFocus={e => (e.currentTarget.style.borderColor = 'var(--color-primary)')}
            onBlur={e => (e.currentTarget.style.borderColor = 'var(--color-surface-700)')}
          />
        </div>

        <div className="flex flex-col gap-[6px]">
          <label className={labelClass} style={labelStyle}>
            RPC URL
          </label>
          <input
            type="text"
            className={inputClass}
            style={inputStyle}
            value={rpcUrl}
            onChange={e => setRpcUrl(e.target.value)}
            onFocus={e => (e.currentTarget.style.borderColor = 'var(--color-primary)')}
            onBlur={e => (e.currentTarget.style.borderColor = 'var(--color-surface-700)')}
          />
        </div>

        <div className="flex flex-col gap-[6px]" ref={explorerRef}>
          <label className={labelClass} style={labelStyle}>
            Block explorer URL
          </label>
          <div className="relative">
            <button
              type="button"
              onClick={() => setExplorerOpen(open => !open)}
              aria-expanded={explorerOpen}
              aria-haspopup="listbox"
              aria-label="Block explorer URL"
              className={inputClass + ' flex items-center justify-between cursor-pointer gap-2'}
              style={inputStyle}
            >
              <span className="flex items-center gap-2 min-w-0">
                {BLOCK_EXPLORER_ICONS[blockExplorerUrl] && (
                  <span className="w-10 h-10 rounded-lg bg-white flex items-center justify-center shrink-0">
                    <img
                      src={BLOCK_EXPLORER_ICONS[blockExplorerUrl]}
                      alt=""
                      className="w-6 h-6"
                    />
                  </span>
                )}
                <span className="truncate">
                  {BLOCK_EXPLORER_OPTIONS.find(o => o.value === blockExplorerUrl)?.label ??
                    blockExplorerUrl}
                </span>
              </span>
              <span
                className="shrink-0 transition-transform"
                style={{ transform: explorerOpen ? 'rotate(180deg)' : undefined }}
              >
                <ChevronDownIcon className="w-5 h-5" />
              </span>
            </button>
            {explorerOpen && (
              <div
                className="absolute left-0 right-0 top-full mt-1 rounded-lg border overflow-hidden z-50 flex flex-col p-1.5 gap-1.5"
                style={{
                  backgroundColor: 'var(--color-bg)',
                  borderColor: 'var(--color-surface-700)',
                }}
                role="listbox"
              >
                {BLOCK_EXPLORER_OPTIONS.map(opt => {
                  const selected = blockExplorerUrl === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      role="option"
                      aria-checked={selected}
                      className="flex items-center justify-between px-3 py-2 rounded-lg transition-colors text-left w-full cursor-pointer focus:outline-none focus-visible:ring-2"
                      style={{
                        color: 'var(--color-text-primary)',
                        backgroundColor: selected ? 'var(--color-surface-900)' : 'transparent',
                      }}
                      onMouseEnter={e =>
                        (e.currentTarget.style.backgroundColor = 'var(--color-surface-900)')
                      }
                      onMouseLeave={e =>
                        (e.currentTarget.style.backgroundColor = selected ? 'var(--color-surface-900)' : 'transparent')
                      }
                      onClick={() => {
                        setBlockExplorerUrl(opt.value);
                        setExplorerOpen(false);
                      }}
                    >
                      <span className="flex items-center gap-2 text-sm font-medium leading-[18px] tracking-[0.14px] flex-1 min-w-0">
                        {BLOCK_EXPLORER_ICONS[opt.value] && (
                          <span className="w-10 h-10 rounded-lg bg-white flex items-center justify-center shrink-0">
                            <img
                              src={BLOCK_EXPLORER_ICONS[opt.value]}
                              alt=""
                              className="w-6 h-6"
                            />
                          </span>
                        )}
                        {opt.label}
                      </span>
                      <span
                        className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 transition-all"
                        style={{
                          border: `1px solid ${selected ? 'var(--color-primary)' : 'var(--color-surface-700)'}`,
                          backgroundColor: selected ? 'var(--color-primary)' : 'var(--color-bg)',
                        }}
                      >
                        {selected && (
                          <span className="w-3 h-3 rounded-full" style={{ backgroundColor: '#000' }} />
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Reset + Save */}
      <div className="p-4 pt-2 shrink-0 flex flex-col gap-3">
        <button
          type="button"
          onClick={handleResetToDefault}
          className="text-sm font-semibold underline py-1 self-center focus:outline-none focus-visible:ring-2 rounded"
          style={{ color: 'var(--color-text-primary)' }}
        >
          Reset to default
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saveStatus === 'saving'}
          className="w-full h-12 rounded-lg text-sm font-medium leading-[18px] tracking-[0.14px] transition-opacity hover:opacity-90 active:opacity-80 disabled:opacity-70 disabled:cursor-not-allowed"
          style={{ backgroundColor: 'var(--color-primary)', color: '#000' }}
        >
          {saveStatus === 'saving' ? 'Saving...' : saveStatus === 'saved' ? 'Saved!' : 'Save'}
        </button>
      </div>
    </div>
  );
}
