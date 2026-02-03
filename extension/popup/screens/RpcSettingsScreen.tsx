import { useState, useRef, useEffect } from 'react';
import { useStore } from '../store';
import { useClickOutside } from '../hooks/useClickOutside';
import { ChevronLeftIcon } from '../components/icons/ChevronLeftIcon';
import RefreshIcon from '../assets/refresh-icon.svg';
import {
  defaultRpcConfig,
  getEffectiveRpcConfig,
  saveRpcConfig,
  clearRpcConfig,
} from '../../shared/rpc-config';

export function RpcSettingsScreen() {
  const { navigate } = useStore();
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [networkName, setNetworkName] = useState(defaultRpcConfig.networkName);
  const [rpcUrl, setRpcUrl] = useState(defaultRpcConfig.rpcUrl);
  const [chainId, setChainId] = useState(defaultRpcConfig.chainId);
  const [currencySymbol, setCurrencySymbol] = useState(defaultRpcConfig.currencySymbol);
  const [blockExplorerUrl, setBlockExplorerUrl] = useState(defaultRpcConfig.blockExplorerUrl);
  const [isLoading, setIsLoading] = useState(true);

  useClickOutside(menuRef, () => setMenuOpen(false), menuOpen);

  useEffect(() => {
    getEffectiveRpcConfig().then(config => {
      setNetworkName(config.networkName);
      setRpcUrl(config.rpcUrl);
      setChainId(config.chainId);
      setCurrencySymbol(config.currencySymbol);
      setBlockExplorerUrl(config.blockExplorerUrl);
      setIsLoading(false);
    });
  }, []);

  function handleBack() {
    navigate('settings');
  }

  async function handleSave() {
    await saveRpcConfig({
      networkName,
      rpcUrl: rpcUrl.trim(),
      chainId: chainId.trim(),
      currencySymbol: currencySymbol.trim(),
      blockExplorerUrl: blockExplorerUrl.trim(),
    });
  }

  async function handleResetToDefault() {
    setNetworkName(defaultRpcConfig.networkName);
    setRpcUrl(defaultRpcConfig.rpcUrl);
    setChainId(defaultRpcConfig.chainId);
    setCurrencySymbol(defaultRpcConfig.currencySymbol);
    setBlockExplorerUrl(defaultRpcConfig.blockExplorerUrl);
    await clearRpcConfig();
    setMenuOpen(false);
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

        <h1 className="m-0 text-base font-medium leading-[22px] tracking-[0.16px]">
          RPC settings
        </h1>

        <div ref={menuRef} className="relative shrink-0">
          <button
            type="button"
            aria-label="More options"
            aria-expanded={menuOpen}
            aria-haspopup="true"
            className="w-8 h-8 flex items-center justify-center rounded-lg transition-colors focus:outline-none focus-visible:ring-2"
            style={{ color: 'var(--color-text-primary)' }}
            onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--color-surface-800)')}
            onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
            onClick={() => setMenuOpen(open => !open)}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <circle cx="12" cy="6" r="1.5" />
              <circle cx="12" cy="12" r="1.5" />
              <circle cx="12" cy="18" r="1.5" />
            </svg>
          </button>

          {menuOpen && (
            <div
              className="absolute right-0 top-full mt-1 min-w-[180px] rounded-lg z-50 border overflow-hidden"
              style={{
                backgroundColor: 'var(--color-bg)',
                borderColor: 'var(--color-surface-700)',
              }}
              role="menu"
            >
              <button
                type="button"
                role="menuitem"
                className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left font-medium text-sm transition-colors focus:outline-none focus-visible:ring-2"
                style={{ color: 'var(--color-text-primary)' }}
                onMouseEnter={e => {
                  e.currentTarget.style.backgroundColor = 'var(--color-surface-800)';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.backgroundColor = 'transparent';
                }}
                onClick={handleResetToDefault}
              >
                <span
                  className="w-7 h-7 rounded-md flex items-center justify-center shrink-0"
                  style={{ backgroundColor: 'var(--color-surface-800)' }}
                  aria-hidden
                >
                  <img src={RefreshIcon} alt="" className="w-4 h-4" />
                </span>
                Reset to default
              </button>
            </div>
          )}
        </div>
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

        <div className="flex flex-col gap-[6px]">
          <label className={labelClass} style={labelStyle}>
            Chain ID
          </label>
          <input
            type="text"
            className={inputClass}
            style={inputStyle}
            value={chainId}
            onChange={e => setChainId(e.target.value)}
            onFocus={e => (e.currentTarget.style.borderColor = 'var(--color-primary)')}
            onBlur={e => (e.currentTarget.style.borderColor = 'var(--color-surface-700)')}
          />
        </div>

        <div className="flex flex-col gap-[6px]">
          <label className={labelClass} style={labelStyle}>
            Currency symbol
          </label>
          <input
            type="text"
            className={inputClass}
            style={inputStyle}
            value={currencySymbol}
            onChange={e => setCurrencySymbol(e.target.value)}
            onFocus={e => (e.currentTarget.style.borderColor = 'var(--color-primary)')}
            onBlur={e => (e.currentTarget.style.borderColor = 'var(--color-surface-700)')}
          />
        </div>

        <div className="flex flex-col gap-[6px]">
          <label className={labelClass} style={labelStyle}>
            Block explorer URL
          </label>
          <input
            type="text"
            className={inputClass}
            style={inputStyle}
            value={blockExplorerUrl}
            onChange={e => setBlockExplorerUrl(e.target.value)}
            onFocus={e => (e.currentTarget.style.borderColor = 'var(--color-primary)')}
            onBlur={e => (e.currentTarget.style.borderColor = 'var(--color-surface-700)')}
          />
        </div>
      </div>

      {/* Save button */}
      <div className="p-4 pt-2 shrink-0">
        <button
          type="button"
          onClick={handleSave}
          className="w-full h-12 rounded-lg text-sm font-medium leading-[18px] tracking-[0.14px] transition-opacity hover:opacity-90 active:opacity-80"
          style={{ backgroundColor: 'var(--color-primary)', color: '#000' }}
        >
          Save
        </button>
      </div>
    </div>
  );
}
