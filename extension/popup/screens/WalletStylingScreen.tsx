import { useState, useEffect, useRef } from 'react';
import { useStore } from '../store';
import { send } from '../utils/messaging';
import { INTERNAL_METHODS } from '../../shared/constants';
import {
  ACCOUNT_COLORS,
  DEFAULT_WALLET_STYLE,
  WALLET_ICONS,
  normalizeIconStyleId,
} from '../../shared/walletStyles';
import { WALLET_ICON_ASSETS } from '../components/walletIconAssets';
import { ChevronLeftIcon } from '../components/icons/ChevronLeftIcon';
import { ChevronRightIcon } from '../components/icons/ChevronRightIcon';

export function WalletStylingScreen() {
  const { navigate, wallet, refreshWalletAccounts, settingsAccountAddress } = useStore();

  // Style the account selected in wallet settings (if present), otherwise current account
  const currentAccount =
    (settingsAccountAddress
      ? wallet.accounts.find(a => a.address === settingsAccountAddress)
      : null) ??
    wallet.currentAccount ??
    wallet.accounts.find(a => !a.hidden) ??
    wallet.accounts[0];

  // Load initial values from current account or use defaults
  const [selectedStyle, setSelectedStyle] = useState(
    normalizeIconStyleId(currentAccount?.iconStyleId)
  );
  const [selectedColor, setSelectedColor] = useState(
    currentAccount?.iconColor || DEFAULT_WALLET_STYLE.iconColor
  );
  const [svgContent, setSvgContent] = useState<string>('');

  // Track if we're scrolled to the end (false = at start, true = at end)
  const [isScrolledRight, setIsScrolledRight] = useState(false);
  const colorScrollRef = useRef<HTMLDivElement>(null);

  // Shared icon registry (picker order: similar styles grouped) and color palette
  const iconStyles = WALLET_ICONS.map(icon => ({ id: icon.id, icon: WALLET_ICON_ASSETS[icon.id] }));
  const colors = ACCOUNT_COLORS;

  // Sync state when current account changes
  useEffect(() => {
    if (currentAccount) {
      setSelectedStyle(normalizeIconStyleId(currentAccount.iconStyleId));
      const color = currentAccount.iconColor || DEFAULT_WALLET_STYLE.iconColor;
      setSelectedColor(color);
    }
  }, [currentAccount?.address, currentAccount?.iconStyleId, currentAccount?.iconColor]);

  // Load and modify SVG based on selected style and color
  useEffect(() => {
    const selectedIcon = iconStyles.find(s => s.id === selectedStyle);
    if (!selectedIcon) return;

    fetch(selectedIcon.icon)
      .then(res => res.text())
      .then(text => {
        // Replace CSS var `--fill-0` with the chosen color
        const modifiedSvg = text.replace(/var\(--fill-0,\s*#[A-Fa-f0-9]{6}\)/g, selectedColor);
        setSvgContent(modifiedSvg);
      })
      .catch(err => console.error('Failed to load SVG:', err));
  }, [selectedStyle, selectedColor]);

  // Persist styling changes
  async function handleStyleChange(styleId: string) {
    if (!currentAccount) return;

    setSelectedStyle(styleId);

    const result = await send<{ ok?: boolean; error?: string }>(
      INTERNAL_METHODS.UPDATE_ACCOUNT_STYLING,
      [currentAccount.address, styleId, selectedColor]
    );

    if (result?.ok) {
      await refreshWalletAccounts();
    } else if (result?.error) {
      console.error('Failed to update styling:', result.error);
    }
  }

  async function handleColorChange(color: string) {
    if (!currentAccount) return;

    setSelectedColor(color);

    const result = await send<{ ok?: boolean; error?: string }>(
      INTERNAL_METHODS.UPDATE_ACCOUNT_STYLING,
      [currentAccount.address, selectedStyle, color]
    );

    if (result?.ok) {
      await refreshWalletAccounts();
    } else if (result?.error) {
      console.error('Failed to update styling:', result.error);
    }
  }

  function handleBack() {
    navigate('wallet-settings');
  }

  function handleColorScrollLeft() {
    if (!colorScrollRef.current) return;
    // Scroll to the start
    colorScrollRef.current.scrollTo({
      left: 0,
      behavior: 'smooth',
    });
    setIsScrolledRight(false);
  }

  function handleColorScrollRight() {
    if (!colorScrollRef.current) return;
    // Scroll to the end
    colorScrollRef.current.scrollTo({
      left: colorScrollRef.current.scrollWidth,
      behavior: 'smooth',
    });
    setIsScrolledRight(true);
  }

  return (
    <div
      className="w-full h-full flex flex-col"
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
          style={{ color: 'var(--color-text-primary)' }}
          onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--color-surface-800)')}
          onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
        >
          <ChevronLeftIcon className="w-5 h-5" />
        </button>
        <h1 className="m-0 text-base font-medium leading-[22px] tracking-[0.16px]">Styling</h1>
        <div className="w-8 h-8" />
      </header>

      {/* Content */}
      <div className="flex flex-col gap-[20px] flex-1 min-h-0 pt-[16px] px-0 pb-0">
        {/* Preview */}
        <div className="flex items-center justify-center shrink-0">
          <div className="w-24 h-24 block" dangerouslySetInnerHTML={{ __html: svgContent }} />
        </div>

        {/* Inner wrapper for padding */}
        <div className="flex flex-col gap-[32px] px-[16px] py-[12px] flex-1 min-h-0">
          {/* Icon Styles Section */}
          <div className="flex flex-col gap-[10px] flex-1 min-h-0">
            <h2 className="text-sm font-medium leading-[18px] tracking-[0.14px] text-center m-0">
              Icon style
            </h2>
            <div className="flex-1 overflow-y-auto min-h-0">
              <div className="flex flex-wrap gap-[8px] justify-center">
                {iconStyles.map(style => {
                  const selected = selectedStyle === style.id;
                  return (
                    <button
                      key={style.id}
                      type="button"
                      onClick={() => handleStyleChange(style.id)}
                      className={`flex items-center justify-center p-[10px] rounded-[12px] transition-colors focus:outline-none focus-visible:ring-2 shrink-0 ${!selected ? 'hover:bg-[var(--color-surface-900)]' : ''}`}
                      style={{
                        width: '58px',
                        height: '58px',
                        backgroundColor: 'var(--color-bg)',
                        border: `1px solid ${selected ? 'var(--color-text-primary)' : 'var(--color-surface-800)'}`,
                      }}
                      aria-pressed={selected}
                    >
                      <img src={style.icon} alt={`Style ${style.id}`} className="w-6 h-6" />
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Icon Color Section */}
          <div className="shrink-0 flex flex-col gap-[10px] pb-[24px]">
            <div className="flex items-center gap-[9px]">
              <button
                type="button"
                onClick={handleColorScrollLeft}
                disabled={!isScrolledRight}
                className="p-[8px] transition-opacity focus:outline-none focus-visible:ring-2 disabled:opacity-30"
                aria-label="Previous color"
              >
                <ChevronLeftIcon className="w-5 h-5" />
              </button>
              <h2 className="flex-1 text-sm font-medium leading-[18px] tracking-[0.14px] text-center m-0">
                Icon color
              </h2>
              <button
                type="button"
                onClick={handleColorScrollRight}
                disabled={isScrolledRight}
                className="p-[8px] transition-opacity focus:outline-none focus-visible:ring-2 disabled:opacity-30"
                aria-label="Next color"
              >
                <ChevronRightIcon className="w-5 h-5" />
              </button>
            </div>
            {/* The rail */}
            <div className="overflow-hidden">
              <div
                ref={colorScrollRef}
                className="flex gap-[8px] justify-start overflow-x-auto snap-x snap-mandatory"
                style={{
                  scrollbarWidth: 'none',
                  msOverflowStyle: 'none',
                  scrollPaddingLeft: 0,
                  scrollPaddingRight: 0,
                }}
              >
                {colors.map(color => {
                  const selected = selectedColor === color;
                  return (
                    <button
                      key={color}
                      type="button"
                      onClick={() => handleColorChange(color)}
                      className={`flex items-center justify-center p-0 rounded-[12px] transition-colors focus:outline-none focus-visible:ring-2 shrink-0 snap-start ${!selected ? 'hover:bg-[var(--color-surface-900)]' : ''}`}
                      style={{
                        width: '46px',
                        height: '46px',
                        backgroundColor: 'var(--color-bg)',
                        border: `1px solid ${selected ? 'var(--color-text-primary)' : 'var(--color-surface-800)'}`,
                      }}
                      aria-label={`Color ${color}`}
                      aria-pressed={selected}
                    >
                      <div className="w-5 h-5 rounded-full" style={{ backgroundColor: color }} />
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
