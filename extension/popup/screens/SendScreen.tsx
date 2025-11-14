import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { useTheme } from '../contexts/ThemeContext';
import { truncateAddress } from '../utils/format';
import { send } from '../utils/messaging';
import { INTERNAL_METHODS, DEFAULT_TRANSACTION_FEE, NOCK_TO_NICKS } from '../../shared/constants';
import { roundNockToSendable, formatNock, isDustAmount, MIN_SENDABLE_NOCK } from '../../shared/currency';
import type { Account } from '../../shared/types';
import { AccountIcon } from '../components/AccountIcon';
import { ChevronLeftIcon } from '../components/icons/ChevronLeftIcon';
import { ChevronDownIcon } from '../components/icons/ChevronDownIcon';
import { base58 } from '@scure/base';
import PencilEditIcon from '../assets/pencil-edit-icon.svg';
import CheckmarkIcon from '../assets/checkmark-pencil-icon.svg';
import InfoIcon from '../assets/info-icon.svg';

function formatInt(n: number) {
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

export function SendScreen() {
  const { theme } = useTheme();
  const { navigate, wallet, syncWallet, setLastTransaction } = useStore();

  const [walletDropdownOpen, setWalletDropdownOpen] = useState(false);
  const [receiverAddress, setReceiverAddress] = useState('');
  const [amount, setAmount] = useState('');
  // Default fee: 28 NOCK (1,835,008 nicks)
  const defaultFeeNock = (DEFAULT_TRANSACTION_FEE / NOCK_TO_NICKS).toString();
  const [fee, setFee] = useState(defaultFeeNock);
  const [isEditingFee, setIsEditingFee] = useState(false);
  const [editedFee, setEditedFee] = useState(defaultFeeNock);
  const [showFeeTooltip, setShowFeeTooltip] = useState(false);
  const [error, setError] = useState('');

  // Get real accounts from vault (filter out hidden accounts)
  const accounts = (wallet.accounts || []).filter(acc => !acc.hidden);
  const currentAccount = wallet.currentAccount || accounts[0];
  const currentBalance = wallet.balance;

  // Account switching handler
  async function handleSwitchAccount(index: number) {
    const result = await send<{ ok?: boolean; account?: Account; error?: string }>(
      INTERNAL_METHODS.SWITCH_ACCOUNT,
      [index]
    );

    if (result?.ok && result.account) {
      const updatedWallet = {
        ...wallet,
        currentAccount: result.account,
        address: result.account.address,
      };
      syncWallet(updatedWallet);
    }

    setWalletDropdownOpen(false);
  }

  function handleMaxAmount() {
    setAmount(formatNock(currentBalance));
  }

  function handleAmountBlur() {
    if (!amount || amount === '') return;
    
    const numAmount = parseFloat(amount.replace(/,/g, ''));
    if (isNaN(numAmount) || numAmount <= 0 || !isFinite(numAmount)) return;
    
    const roundedAmount = roundNockToSendable(numAmount);
    setAmount(formatNock(roundedAmount));
  }

  function handleEditFee() {
    setIsEditingFee(true);
    setEditedFee(fee);
  }

  function handleSaveFee() {
    const feeNum = parseFloat(editedFee);
    if (!isNaN(feeNum) && feeNum >= 0) {
      setFee(editedFee);
    }
    setIsEditingFee(false);
  }

  function handleFeeInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value;
    // Only allow numbers and single decimal point
    if (value === '' || /^\d*\.?\d*$/.test(value)) {
      setEditedFee(value);
    }
  }

  function handleFeeInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      handleSaveFee();
    }
    if (e.key === 'Escape') {
      setIsEditingFee(false);
      setEditedFee(fee);
    }
  }

  function handleCancel() {
    navigate('home');
  }

  function handleContinue() {
    setError('');

    // Validation
    if (!receiverAddress.trim()) {
      setError('Please enter a receiver address');
      return;
    }

    // Check for self-send
    if (receiverAddress.trim() === currentAccount?.address) {
      setError('Address cannot be your own');
      return;
    }

    // Validate V1 PKH address by decoding and checking for exactly 40 bytes
    try {
      const bytes = base58.decode(receiverAddress.trim());
      if (bytes.length !== 40) {
        setError('Invalid Nockchain address (V1 PKH: 40 bytes expected)');
        return;
      }
    } catch {
      setError('Invalid Nockchain address (invalid base58 encoding)');
      return;
    }

    const amountNum = parseFloat(amount.replace(/,/g, ''));
    if (!amount || isNaN(amountNum) || amountNum <= 0) {
      setError('Please enter a valid amount');
      return;
    }

    if (isDustAmount(amountNum)) {
      const minFormatted = MIN_SENDABLE_NOCK.toFixed(16).replace(/\.?0+$/, '');
      setError(`Amount too small. Minimum: ${minFormatted} NOCK`);
      return;
    }

    const feeNum = parseFloat(fee);
    if (!fee || isNaN(feeNum) || feeNum < 0) {
      setError('Please enter a valid fee');
      return;
    }

    // TODO: Re-enable balance check for production
    // Skip balance check for development
    // if (amountNum + feeNum > currentBalance) {
    //   setError(`Insufficient balance`);
    //   return;
    // }

    // Store transaction details for review screen
    setLastTransaction({
      txid: '', // Will be generated when actually sent
      amount: amountNum,
      fee: feeNum,
      to: receiverAddress.trim(),
      from: currentAccount?.address,
    });

    navigate('send-review');
  }

  // --- Dropdown sizing/positioning (prevents going off screen) ----------------
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});
  const [renderAbove, setRenderAbove] = useState(false);

  useLayoutEffect(() => {
    if (!walletDropdownOpen || !triggerRef.current) return;

    const update = () => {
      const r = triggerRef.current!.getBoundingClientRect();
      const width = r.width;
      const left = r.left;
      const gap = 4;

      // Provisional height (measure if already mounted)
      let menuHeight = 240;
      if (menuRef.current) {
        const mh = menuRef.current.getBoundingClientRect().height;
        if (mh) menuHeight = Math.min(mh, 240);
      }

      const spaceBelow = window.innerHeight - r.bottom - gap;
      const shouldFlip = spaceBelow < menuHeight && r.top > menuHeight;

      const top = shouldFlip ? Math.max(8, r.top - menuHeight - gap) : r.bottom + gap;

      setRenderAbove(!!shouldFlip);
      setMenuStyle({
        position: 'fixed',
        left,
        top,
        width,
        zIndex: 50,
      });
    };

    update();
    // Reposition on scroll/resize while open
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    // Wait one frame to measure actual menu height
    const raf = requestAnimationFrame(update);

    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
      cancelAnimationFrame(raf);
    };
  }, [walletDropdownOpen]);

  // Close on outside click / escape
  useEffect(() => {
    if (!walletDropdownOpen) return;
    const onDown = (e: MouseEvent) => {
      if (
        triggerRef.current?.contains(e.target as Node) ||
        menuRef.current?.contains(e.target as Node)
      ) {
        return;
      }
      setWalletDropdownOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setWalletDropdownOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [walletDropdownOpen]);

  // -----------------------------------------------------------------------------

  return (
    <div
      className="w-[357px] h-[600px] flex flex-col"
      style={{ backgroundColor: 'var(--color-bg)', color: 'var(--color-text-primary)' }}
    >
      {/* Header */}
      <header
        className="flex items-center justify-between h-16 px-4"
        style={{ borderBottom: '1px solid var(--color-divider)' }}
      >
        <button
          className="p-2 transition"
          style={{ color: 'var(--color-text-primary)', opacity: 0.8 }}
          onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
          onMouseLeave={e => (e.currentTarget.style.opacity = '0.8')}
          onClick={handleCancel}
          aria-label="Back"
        >
          <ChevronLeftIcon className="w-5 h-5" />
        </button>
        <h1 className="text-[16px] font-medium tracking-[0.01em]">Send NOCK</h1>
        <div className="w-7" /> {/* spacer to balance the back button */}
      </header>

      {/* Wallet Selector */}
      <div className="px-4 pt-2">
        <div className="relative">
          <button
            ref={triggerRef}
            type="button"
            className="w-full rounded-lg p-2 pr-4 flex items-center gap-2 focus:outline-none focus:ring-2"
            style={{
              border: '1px solid var(--color-surface-700)',
              backgroundColor: 'var(--color-bg)',
              cursor: accounts.length <= 1 ? 'default' : 'pointer',
            }}
            onClick={() => accounts.length > 1 && setWalletDropdownOpen(o => !o)}
            aria-haspopup="listbox"
            aria-expanded={walletDropdownOpen}
            disabled={accounts.length <= 1}
          >
            <div
              className="flex-shrink-0 w-10 h-10 rounded-lg grid place-items-center"
              style={{ backgroundColor: 'var(--color-surface-800)' }}
            >
              <AccountIcon
                styleId={currentAccount?.iconStyleId}
                color={currentAccount?.iconColor}
                className="w-6 h-6"
              />
            </div>
            <div className="flex-1 text-left">
              <div className="text-[14px] leading-[18px] font-medium tracking-[0.01em]">
                {currentAccount?.name || 'Wallet'}
              </div>
              <div
                className="text-[13px] leading-[18px] tracking-[0.02em]"
                style={{ color: 'var(--color-text-muted)' }}
              >
                {truncateAddress(currentAccount?.address)}
              </div>
            </div>
            {accounts.length > 1 && (
              <ChevronDownIcon
                className={`w-4 h-4 transition-transform ${walletDropdownOpen ? 'rotate-180' : ''}`}
              />
            )}
          </button>

          {walletDropdownOpen && (
            <div
              ref={menuRef}
              style={{
                ...menuStyle,
                backgroundColor: 'var(--color-bg)',
                border: '1px solid var(--color-surface-700)',
              }}
              role="listbox"
              className="rounded-xl shadow-[0_4px_12px_rgba(0,0,0,0.1)] p-1 max-h-[240px] overflow-y-auto"
            >
              {accounts.map(account => {
                const isSelected = currentAccount?.index === account.index;
                return (
                  <button
                    key={account.index}
                    role="option"
                    aria-selected={isSelected}
                    className="w-full flex items-center gap-2 p-2 rounded-lg transition border"
                    style={{
                      backgroundColor: 'var(--color-bg)',
                      borderColor: isSelected ? 'var(--color-text-primary)' : 'transparent',
                    }}
                    onMouseEnter={e => {
                      if (!isSelected) {
                        e.currentTarget.style.backgroundColor = 'var(--color-surface-900)';
                      }
                    }}
                    onMouseLeave={e => {
                      if (!isSelected) {
                        e.currentTarget.style.backgroundColor = 'var(--color-bg)';
                      }
                    }}
                    onClick={() => handleSwitchAccount(account.index)}
                  >
                    <div
                      className="flex-shrink-0 w-10 h-10 rounded-lg grid place-items-center"
                      style={{ backgroundColor: 'var(--color-bg)' }}
                    >
                      <AccountIcon
                        styleId={account.iconStyleId}
                        color={account.iconColor}
                        className="w-6 h-6"
                      />
                    </div>
                    <div className="flex-1 text-left">
                      <div className="text-[14px] leading-[18px] font-medium tracking-[0.01em]">
                        {account.name}
                      </div>
                      <div
                        className="text-[13px] leading-[18px] tracking-[0.02em]"
                        style={{ color: 'var(--color-text-muted)' }}
                      >
                        {truncateAddress(account.address)}
                      </div>
                    </div>
                    <div className="ml-auto text-[14px] leading-[18px] font-medium tracking-[0.01em] whitespace-nowrap">
                      {formatInt(currentBalance)} NOCK
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Amount */}
      <div className="flex flex-col items-center gap-3 px-4 pt-16 mb-12">
        <input
          type="text"
          inputMode="decimal"
          className="w-full bg-transparent border-0 text-center outline-none font-serif text-[48px] leading-[48px] font-semibold tracking-[-0.036em]"
          style={{
            color: 'var(--color-text-primary)',
          }}
          placeholder="100.00"
          value={amount}
          onChange={e => {
            const value = e.target.value;
            if (value === '' || /^[\d,]*\.?\d{0,5}$/.test(value)) {
              setAmount(value);
            }
          }}
          onBlur={handleAmountBlur}
        />
        <div className="w-full h-px" style={{ backgroundColor: 'var(--color-surface-700)' }} />
        <div className="flex items-center gap-2">
          <div
            className="text-[12px] leading-4 font-medium tracking-[0.02em]"
            style={{ color: 'var(--color-text-muted)' }}
          >
            Balance: {formatInt(currentBalance)} NOCK
          </div>
          <button
            onClick={handleMaxAmount}
            className="rounded-full text-[12px] leading-4 font-medium px-[7px] py-[3px] transition"
            style={{ backgroundColor: 'var(--color-surface-800)' }}
            onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--color-surface-700)')}
            onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'var(--color-surface-800)')}
          >
            Max
          </button>
        </div>
      </div>

      {/* Form */}
      <div className="flex-1 overflow-y-auto flex flex-col gap-2 px-4">
        {/* Receiver */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[13px] leading-[18px] font-medium tracking-[0.02em]">
            Receiver address
          </label>
          <input
            type="text"
            placeholder="Enter Nockchain address"
            value={receiverAddress}
            onChange={e => setReceiverAddress(e.target.value)}
            className="w-full rounded-lg px-4 py-[21px] text-[16px] leading-[22px] font-medium tracking-[0.01em] outline-none"
            style={{
              border: '1px solid var(--color-surface-700)',
              backgroundColor: 'var(--color-bg)',
              color: 'var(--color-text-primary)',
            }}
            onFocus={e => (e.currentTarget.style.borderColor = 'var(--color-primary)')}
            onBlur={e => (e.currentTarget.style.borderColor = 'var(--color-surface-700)')}
          />
        </div>

        {/* Fee */}
        <div className="flex flex-col gap-1.5 mb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-[14px] leading-[18px] font-medium">
              Fee
              <div
                className="relative inline-block"
                onMouseEnter={() => setShowFeeTooltip(true)}
                onMouseLeave={() => setShowFeeTooltip(false)}
              >
                <img src={InfoIcon} alt="Fee information" className="w-4 h-4 cursor-help" />
                
                {showFeeTooltip && (
                  <div className="absolute left-0 bottom-full mb-2 w-64 z-50">
                    <div
                      className="rounded-lg px-3 py-2.5 text-[12px] leading-4 font-medium tracking-[0.02em] shadow-lg"
                      style={{
                        backgroundColor: 'var(--color-surface-800)',
                        color: 'var(--color-text-muted)',
                        border: '1px solid var(--color-surface-700)'
                      }}
                    >
                      Network transaction fee. Adjustable if needed.
                      
                      <div
                        className="absolute left-4 top-full w-0 h-0"
                        style={{
                          borderLeft: '6px solid transparent',
                          borderRight: '6px solid transparent',
                          borderTop: '6px solid var(--color-surface-800)',
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
            {isEditingFee ? (
              <div
                className="rounded-lg pl-1 pr-1 py-1 inline-flex items-center gap-2 "
                style={{ border: '1px solid var(--color-surface-700)' }}
              >
                <input
                  type="text"
                  inputMode="decimal"
                  value={editedFee}
                  onChange={handleFeeInputChange}
                  onKeyDown={handleFeeInputKeyDown}
                  autoFocus
                  className="w-8 h-3 bg-transparent outline-none text-[14px] leading-[18px] font-medium text-right"
                  style={{ color: 'var(--color-text-primary)' }}
                  placeholder="1"
                />
                <span
                  className="text-[14px] leading-[18px] font-medium"
                  style={{ color: 'var(--color-text-muted)' }}
                >
                  NOCK
                </span>
                <button
                  type="button"
                  onClick={handleSaveFee}
                  className="p-0.5 rounded transition-opacity hover:opacity-80 focus:outline-none"
                  aria-label="Save fee"
                >
                  <img src={CheckmarkIcon} alt="" className="w-5 h-5" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleEditFee}
                className="rounded-lg pl-2.5 pr-2 py-1.5 flex items-center gap-2 transition-colors focus:outline-none"
                style={{ backgroundColor: 'var(--color-surface-800)' }}
                onMouseEnter={e =>
                  (e.currentTarget.style.backgroundColor = 'var(--color-surface-700)')
                }
                onMouseLeave={e =>
                  (e.currentTarget.style.backgroundColor = 'var(--color-surface-800)')
                }
              >
                <div
                  className="text-[14px] leading-[18px] font-medium"
                  style={{ color: 'var(--color-text-muted)' }}
                >
                  {fee} NOCK
                </div>
                <img src={PencilEditIcon} alt="Edit" className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Actions */}
      <div
        className="flex flex-col gap-2 p-3 mt-auto"
        style={{ borderTop: '1px solid var(--color-divider)' }}
      >
        {error && (
          <div
            className="px-3 py-2 text-[13px] leading-[18px] font-medium rounded-lg"
            style={{
              backgroundColor: 'var(--color-red-light)',
              color: 'var(--color-red)',
            }}
          >
            {error}
          </div>
        )}
        <div className="flex gap-3">
          <button
            className="flex-1 rounded-lg px-5 py-3.5 text-[14px] leading-[18px] font-medium transition"
            style={{ backgroundColor: 'var(--color-surface-800)' }}
            onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--color-surface-700)')}
            onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'var(--color-surface-800)')}
            onClick={handleCancel}
          >
            Cancel
          </button>
          <button
            className="flex-1 rounded-lg px-5 py-3.5 text-[14px] leading-[18px] font-medium transition"
            style={{ backgroundColor: 'var(--color-primary)', color: '#000' }}
            onMouseEnter={e => (e.currentTarget.style.opacity = '0.9')}
            onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
            onClick={handleContinue}
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}
