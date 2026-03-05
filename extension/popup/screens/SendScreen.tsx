import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { useTheme } from '../contexts/ThemeContext';
import { truncateAddress } from '../utils/format';
import { send } from '../utils/messaging';
import { INTERNAL_METHODS, NOCK_TO_NICKS } from '../../shared/constants';
import { formatNock, isDustAmount, MIN_SENDABLE_NOCK } from '../../shared/currency';
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
  const { navigate, wallet, syncWallet, setLastTransaction, fetchBalance } = useStore();

  const [walletDropdownOpen, setWalletDropdownOpen] = useState(false);
  const [receiverAddress, setReceiverAddress] = useState('');
  const [amount, setAmount] = useState('');
  // No default fee - will be calculated once user enters amount
  const [fee, setFee] = useState('');
  const [isEditingFee, setIsEditingFee] = useState(false);
  const [editedFee, setEditedFee] = useState('');
  const [showFeeTooltip, setShowFeeTooltip] = useState(false);
  const [showSpendableTooltip, setShowSpendableTooltip] = useState(false);
  const [error, setError] = useState('');
  const [errorType, setErrorType] = useState<'fee_too_low' | 'general' | null>(null);
  const [isFeeManuallyEdited, setIsFeeManuallyEdited] = useState(false);
  const [isCalculatingFee, setIsCalculatingFee] = useState(false);
  const [minimumFee, setMinimumFee] = useState<number | null>(null); // Minimum fee from WASM calculation
  const [isSendingMax, setIsSendingMax] = useState(false); // Track if user is sending entire balance
  const [isLoadingBalance, setIsLoadingBalance] = useState(false); // Track balance refresh after account switch

  // Get real accounts from vault (filter out hidden accounts)
  const accounts = (wallet.accounts || []).filter(acc => !acc.hidden);
  const currentAccount = wallet.currentAccount || accounts[0];
  // Use spendable balance (only UTXOs that are not in_flight - can be spent NOW)
  const currentBalance = wallet.spendableBalance;

  // Refresh balance when screen mounts to ensure spendable balance is accurate
  useEffect(() => {
    fetchBalance();
  }, [fetchBalance]);

  // Account switching handler
  async function handleSwitchAccount(index: number) {
    setIsLoadingBalance(true);
    setWalletDropdownOpen(false);

    // Clear amount and fee fields when switching accounts
    setAmount('');
    setFee('');
    setEditedFee('');
    setMinimumFee(null);
    setIsFeeManuallyEdited(false);
    setIsSendingMax(false);
    setError('');
    setErrorType(null);

    try {
      const result = await send<{ ok?: boolean; account?: Account; error?: string }>(
        INTERNAL_METHODS.SWITCH_ACCOUNT,
        [index]
      );

      if (result?.ok && result.account) {
        const updatedWallet = {
          ...wallet,
          currentAccount: result.account,
          address: result.account.address,
          balance: wallet.accountBalances?.[result.account.address] ?? 0,
          spendableBalance: wallet.accountSpendableBalances?.[result.account.address] ?? 0,
        };
        syncWallet(updatedWallet);
        // Refresh balance to ensure spendable balance is accurate for new account
        await fetchBalance();
      }
    } finally {
      setIsLoadingBalance(false);
    }
  }

  async function handleMaxAmount() {
    setIsSendingMax(true);
    setIsCalculatingFee(true);
    setError('');

    try {
      // Use recipient address if valid, otherwise use a dummy address for estimation
      let addressToUse = receiverAddress.trim();

      if (addressToUse) {
        try {
          const bytes = base58.decode(addressToUse);
          if (bytes.length !== 40) {
            addressToUse = ''; // Invalid, will use dummy
          }
        } catch {
          addressToUse = ''; // Invalid base58, will use dummy
        }
      }

      // If no valid address, use dummy (fee doesn't depend on recipient)
      if (!addressToUse) {
        const dummyBytes = new Uint8Array(40).fill(0);
        addressToUse = base58.encode(dummyBytes);
      }

      const result = await send<{
        maxAmount?: number;
        fee?: number;
        totalAvailable?: number;
        utxoCount?: number;
        error?: string;
      }>(INTERNAL_METHODS.ESTIMATE_MAX_SEND, [addressToUse]);

      if (result?.error) {
        console.error('[SendScreen] Max estimation error:', result.error);
        setError(result.error);
        setErrorType('general');
        setIsSendingMax(false);
        return;
      }

      if (result?.maxAmount !== undefined && result?.fee !== undefined) {
        // Set amount to max (already accounts for fee)
        // IMPORTANT: Floor to 5 decimal places to avoid rounding up beyond available balance
        // Standard rounding could make 395.9621276... become 395.96213 which exceeds available
        const maxAmountNock = Math.floor((result.maxAmount / NOCK_TO_NICKS) * 100000) / 100000;
        const feeNock = result.fee / NOCK_TO_NICKS;

        setAmount(formatNock(maxAmountNock));
        setFee(feeNock.toString());
        setEditedFee(feeNock.toString());
        setMinimumFee(feeNock);
        setIsFeeManuallyEdited(true); // Lock fee for max send
        setError('');
        setErrorType(null);
      }
    } catch (err) {
      console.error('[SendScreen] Max estimation failed:', err);
      // Fallback: just set balance (will fail validation if fee not covered)
      setAmount(formatNock(currentBalance));
      setIsSendingMax(false);
    } finally {
      setIsCalculatingFee(false);
    }
  }

  function handleEditFee() {
    setIsEditingFee(true);
    setEditedFee(fee);
  }

  function handleSaveFee() {
    const feeNum = parseFloat(editedFee);
    if (!isNaN(feeNum) && feeNum >= 0) {
      // Validate against minimum fee if we have one
      if (minimumFee !== null && feeNum < minimumFee) {
        setError('Fee too low.');
        setErrorType('fee_too_low');
        // Still allow saving the fee, but show warning
      } else {
        setError('');
        setErrorType(null);
      }
      setFee(editedFee);
      setIsFeeManuallyEdited(true); // Mark as manually edited - stops auto-updates
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

  function handleFeeInputBlur() {
    // Auto-save fee when input loses focus
    handleSaveFee();
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

    // Check if user has sufficient spendable balance for amount + fee
    const totalNeeded = amountNum + feeNum;
    if (totalNeeded > currentBalance) {
      setError(`Insufficient spendable balance`);
      return;
    }

    // Store transaction details for review screen
    setLastTransaction({
      txid: '', // Will be generated when actually sent
      amount: amountNum,
      fee: feeNum,
      to: receiverAddress.trim(),
      from: currentAccount?.address,
      sendMax: isSendingMax, // Flag for sweep transaction (all UTXOs to recipient)
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

  // Dynamic fee estimation - debounced
  useEffect(() => {
    // Skip if user manually edited fee - they have full control
    if (isFeeManuallyEdited) return;

    // Skip if amount is not entered
    if (!amount) return;

    const amountNum = parseFloat(amount.replace(/,/g, ''));
    if (isNaN(amountNum) || amountNum <= 0) return;

    // Use recipient address if provided and valid, otherwise use a dummy address
    // (fee doesn't depend on recipient address, only on amount/UTXOs needed)
    let addressToUse = receiverAddress.trim();

    // Validate address if provided, otherwise use dummy
    if (addressToUse) {
      try {
        const bytes = base58.decode(addressToUse);
        if (bytes.length !== 40) {
          addressToUse = ''; // Invalid, will use dummy
        }
      } catch {
        addressToUse = ''; // Invalid base58, will use dummy
      }
    }

    // If no valid address provided, use a dummy address for estimation
    // The actual recipient doesn't affect fee - only amount/UTXOs matter
    if (!addressToUse) {
      // Dummy V1 PKH address (8 byte version + 32 byte PKH digest)
      const dummyBytes = new Uint8Array(40).fill(0);
      addressToUse = base58.encode(dummyBytes);
    }

    // Show loading state immediately
    setIsCalculatingFee(true);

    // Debounce: wait 500ms before estimating to avoid excessive WASM operations
    const timeoutId = setTimeout(async () => {
      try {
        const amountNicks = Math.floor(amountNum * NOCK_TO_NICKS);
        const result = await send<{ fee?: number; error?: string }>(
          INTERNAL_METHODS.ESTIMATE_TRANSACTION_FEE,
          [addressToUse, amountNicks]
        );

        if (result?.fee) {
          const feeNock = result.fee / NOCK_TO_NICKS;
          setFee(feeNock.toString());
          setEditedFee(feeNock.toString());
          setMinimumFee(feeNock); // Store as minimum required fee
          setError('');
          setErrorType(null);
        } else if (result?.error) {
          console.error('[SendScreen] Fee estimation error from vault:', result.error);
          setError(result.error);
          setErrorType('general');
        } else {
          console.warn('[SendScreen] Fee estimation returned no fee or error:', result);
        }
      } catch (error) {
        console.error('[SendScreen] Fee estimation failed:', error);
        // Keep current fee on error - don't disrupt user experience
      } finally {
        setIsCalculatingFee(false);
      }
    }, 500);

    return () => {
      clearTimeout(timeoutId);
      setIsCalculatingFee(false);
    };
  }, [receiverAddress, amount, isFeeManuallyEdited]);

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
                      {formatInt(wallet.accountSpendableBalances?.[account.address] ?? 0)} NOCK
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
              setIsSendingMax(false); // User manually edited, no longer sending max
            }
          }}
        />
        <div className="w-full h-px" style={{ backgroundColor: 'var(--color-surface-700)' }} />
        <div className="flex items-center gap-2">
          <div
            className="text-[12px] leading-4 font-medium tracking-[0.02em] flex items-center gap-1"
            style={{ color: 'var(--color-text-muted)' }}
          >
            Spendable Balance:{' '}
            {isLoadingBalance ? (
              <span
                className="inline-block w-16 h-3 rounded animate-pulse ml-1"
                style={{ backgroundColor: 'var(--color-surface-700)' }}
              />
            ) : (
              `${formatInt(currentBalance)} NOCK`
            )}
            <div
              className="relative inline-block"
              onMouseEnter={() => setShowSpendableTooltip(true)}
              onMouseLeave={() => setShowSpendableTooltip(false)}
            >
              <img
                src={InfoIcon}
                alt="Spendable balance information"
                className="w-3.5 h-3.5 cursor-help"
              />

              {showSpendableTooltip && (
                <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 w-56 z-50">
                  <div
                    className="rounded-lg px-3 py-2.5 text-[12px] leading-4 font-medium tracking-[0.02em] shadow-lg"
                    style={{
                      backgroundColor: 'var(--color-surface-800)',
                      color: 'var(--color-text-muted)',
                      border: '1px solid var(--color-surface-700)',
                    }}
                  >
                    Excludes UTXOs locked in pending transactions.
                    <div
                      className="absolute left-1/2 -translate-x-1/2 top-full w-0 h-0"
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
                        border: '1px solid var(--color-surface-700)',
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
                  onBlur={handleFeeInputBlur}
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
                className="rounded-lg pl-2.5 pr-2 py-1.5 flex items-center justify-between transition-colors focus:outline-none"
                style={{
                  backgroundColor: 'var(--color-surface-800)',
                  minWidth: '120px',
                  minHeight: '34px',
                }}
                onMouseEnter={e =>
                  (e.currentTarget.style.backgroundColor = 'var(--color-surface-700)')
                }
                onMouseLeave={e =>
                  (e.currentTarget.style.backgroundColor = 'var(--color-surface-800)')
                }
              >
                <div
                  className="text-[14px] leading-[18px] font-medium flex items-center gap-1.5"
                  style={{ color: 'var(--color-text-muted)' }}
                >
                  {isCalculatingFee ? (
                    <div
                      className="w-3.5 h-3.5 border-2 rounded-full animate-spin"
                      style={{
                        borderColor: 'var(--color-text-muted)',
                        borderTopColor: 'transparent',
                      }}
                    />
                  ) : fee ? (
                    `${fee} NOCK`
                  ) : (
                    '-'
                  )}
                </div>
                <img src={PencilEditIcon} alt="Edit" className="w-4 h-4 flex-shrink-0" />
              </button>
            )}
          </div>

          {/* Error display - below fee section */}
          {error && (
            <div
              className="px-3 py-2 text-[13px] leading-[18px] font-medium rounded-lg flex items-center justify-between mt-2"
              style={{
                backgroundColor: 'var(--color-red-light)',
                color: 'var(--color-red)',
              }}
            >
              <span>{error}</span>
              {errorType === 'fee_too_low' && minimumFee !== null && (
                <button
                  type="button"
                  onClick={() => {
                    const feeStr = minimumFee.toString();
                    setFee(feeStr);
                    setEditedFee(feeStr);
                    setError('');
                    setErrorType(null);
                    setIsFeeManuallyEdited(false); // Allow auto-updates again
                  }}
                  className="underline hover:opacity-70 transition-opacity"
                  style={{ color: 'var(--color-red)' }}
                >
                  Reset
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Actions */}
      <div
        className="flex gap-3 p-3 mt-auto"
        style={{ borderTop: '1px solid var(--color-divider)' }}
      >
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
  );
}
