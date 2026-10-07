import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { send } from '../utils/messaging';
import { INTERNAL_METHODS, DISPLAY_MODES, DEFAULT_DISPLAY_MODE } from '../../shared/constants';
import type { DisplayMode } from '../../shared/constants';
import { ChevronLeftIcon } from '../components/icons/ChevronLeftIcon';
import { isSidePanel, isSidePanelSupported } from '../utils/displayContext';
import { SIDE_PANEL_DEFAULT_PATH } from '../../shared/side-panel';

export function DisplayModeScreen() {
  const { navigate } = useStore();
  const [mode, setMode] = useState<DisplayMode>(DEFAULT_DISPLAY_MODE);
  const [isSaving, setIsSaving] = useState(false);
  const [showPopupHint, setShowPopupHint] = useState(false);

  useEffect(() => {
    if (!isSidePanelSupported()) {
      navigate('settings');
    }
  }, [navigate]);

  useEffect(() => {
    send<{ mode: DisplayMode }>(INTERNAL_METHODS.GET_DISPLAY_MODE)
      .then(response => {
        if (response?.mode) {
          setMode(response.mode);
        }
      })
      .catch(console.error);
  }, []);

  function handleBack() {
    navigate('settings');
  }

  async function handleModeSelect(nextMode: DisplayMode) {
    if (nextMode === mode || isSaving) return;

    setIsSaving(true);
    setShowPopupHint(false);

    try {
      const response = await send<{ success?: boolean; mode?: DisplayMode }>(
        INTERNAL_METHODS.SET_DISPLAY_MODE,
        [nextMode]
      );

      const resolvedMode = response?.mode ?? nextMode;
      setMode(resolvedMode);

      if (resolvedMode === DISPLAY_MODES.SIDE_PANEL && !isSidePanel()) {
        try {
          const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (activeTab?.id !== undefined) {
            await chrome.sidePanel.setOptions({
              tabId: activeTab.id,
              path: SIDE_PANEL_DEFAULT_PATH,
              enabled: true,
            });
            await chrome.sidePanel.open({ tabId: activeTab.id });
          } else {
            const currentWindow = await chrome.windows.getCurrent();
            if (currentWindow.id !== undefined) {
              await chrome.sidePanel.open({ windowId: currentWindow.id });
            }
          }
          window.close();
        } catch (error) {
          console.error('[DisplayMode] Failed to open side panel:', error);
        }
        return;
      }

      if (resolvedMode === DISPLAY_MODES.POPUP && isSidePanel()) {
        setShowPopupHint(true);
      }
    } catch (error) {
      console.error('[DisplayMode] Failed to update display mode:', error);
    } finally {
      setIsSaving(false);
    }
  }

  const Option = ({
    label,
    description,
    selected,
    onClick,
    disabled = false,
  }: {
    label: string;
    description: string;
    selected?: boolean;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center justify-between p-3 rounded-lg transition-colors text-left w-full focus:outline-none focus-visible:ring-2 ${
        disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'
      }`}
      style={{ backgroundColor: 'transparent' }}
      onMouseEnter={e => {
        if (!disabled) {
          e.currentTarget.style.backgroundColor = 'var(--color-surface-800)';
        }
      }}
      onMouseLeave={e => {
        e.currentTarget.style.backgroundColor = 'transparent';
      }}
      role="radio"
      aria-checked={!!selected}
    >
      <div className="flex flex-col gap-1 flex-1 pr-3">
        <span className="text-sm font-medium leading-[18px] tracking-[0.14px]">{label}</span>
        <span
          className="text-xs leading-4 tracking-[0.12px]"
          style={{ color: 'var(--color-text-muted)' }}
        >
          {description}
        </span>
      </div>
      <span
        className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 transition-all"
        style={{
          border: `1px solid ${selected ? 'var(--color-primary)' : 'var(--color-surface-700)'}`,
          backgroundColor: selected ? 'var(--color-primary)' : 'var(--color-bg)',
        }}
      >
        {selected && <span className="w-3 h-3 rounded-full" style={{ backgroundColor: '#000' }} />}
      </span>
    </button>
  );

  if (!isSidePanelSupported()) {
    return null;
  }

  return (
    <div
      className="w-full h-full flex flex-col overflow-y-auto"
      style={{ backgroundColor: 'var(--color-bg)', color: 'var(--color-text-primary)' }}
    >
      <header
        className="flex items-center justify-between px-4 py-3 min-h-[64px]"
        style={{ backgroundColor: 'var(--color-bg)' }}
      >
        <button
          type="button"
          onClick={handleBack}
          aria-label="Back"
          className="w-8 h-8 bg-transparent rounded-lg p-2 flex items-center justify-center shrink-0 transition-colors focus:outline-none focus-visible:ring-2"
          onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--color-surface-800)')}
          onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
        >
          <ChevronLeftIcon className="w-5 h-5" />
        </button>
        <h1 className="m-0 text-base font-medium leading-[22px] tracking-[0.16px]">Display mode</h1>
        <div className="w-8 h-8 shrink-0" />
      </header>

      {showPopupHint && (
        <div
          className="mx-3 mb-2 px-3 py-2 rounded-lg text-xs leading-4"
          style={{ backgroundColor: 'var(--color-surface-800)', color: 'var(--color-text-muted)' }}
        >
          Pop-up mode is active. Click the Iris icon in the toolbar to open the wallet in a pop-up
          window.
        </div>
      )}

      <div className="flex flex-col gap-2 px-3 py-2" role="radiogroup" aria-label="Display mode">
        <Option
          label="Pop-up"
          description="Open the wallet in a compact pop-up when you click the extension icon."
          selected={mode === DISPLAY_MODES.POPUP}
          onClick={() => handleModeSelect(DISPLAY_MODES.POPUP)}
          disabled={isSaving}
        />
        <Option
          label="Side panel"
          description="Keep the wallet docked beside your browser tab for quick access while browsing."
          selected={mode === DISPLAY_MODES.SIDE_PANEL}
          onClick={() => handleModeSelect(DISPLAY_MODES.SIDE_PANEL)}
          disabled={isSaving}
        />
      </div>
    </div>
  );
}
