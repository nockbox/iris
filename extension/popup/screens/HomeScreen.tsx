import { useState, useLayoutEffect, useEffect, useRef } from 'react';
import { useStore } from '../store';
import { useTheme } from '../contexts/ThemeContext';
import { truncateAddress } from '../utils/format';
import { send } from '../utils/messaging';
import { INTERNAL_METHODS } from '../../shared/constants';
import type { Account } from '../../shared/types';
import { AccountIcon } from '../components/AccountIcon';
import { EyeIcon } from '../components/icons/EyeIcon';
import { EyeOffIcon } from '../components/icons/EyeOffIcon';
import { CheckIcon } from '../components/icons/CheckIcon';
import { SendPaperPlaneIcon } from '../components/icons/SendPaperPlaneIcon';
import { ReceiveCircleIcon } from '../components/icons/ReceiveCircleIcon';
import { ReceiveArrowIcon } from '../components/icons/ReceiveArrowIcon';
import { SentArrowIcon } from '../components/icons/SentArrowIcon';
import { ArrowUpRightIcon } from '../components/icons/ArrowUpRightIcon';

import WalletDropdownArrow from '../assets/wallet-dropdown-arrow.svg';
import LockIconAsset from '../assets/lock-icon.svg';
import SettingsIconAsset from '../assets/settings-icon.svg';
import TrendUpArrow from '../assets/trend-up-arrow.svg';
import TrendDownArrow from '../assets/trend-down-arrow.svg';
import ExplorerIcon from '../assets/explorer-icon.svg';
import PermissionsIcon from '../assets/permissions-icon.svg';
import FeedbackIcon from '../assets/feedback-icon.svg';
import CopyIcon from '../assets/copy-icon.svg';
import SettingsGearIcon from '../assets/settings-gear-icon.svg';
import PencilEditIcon from '../assets/pencil-edit-icon.svg';
import RefreshIcon from '../assets/refresh-icon.svg';
import ReceiptIcon from '../assets/receipt-icon.svg';

import './HomeScreen.tailwind.css';

/** HomeScreen */
export function HomeScreen() {
  const {
    navigate,
    wallet,
    syncWallet,
    fetchBalance,
    fetchPrice,
    cachedTransactions,
    fetchCachedTransactions,
    setSelectedTransaction,
    updateTransactionStatus,
    isBalanceFetching,
    priceUsd,
    priceChange24h,
    isPriceFetching,
  } = useStore();
  const { theme } = useTheme();

  const [balanceHidden, setBalanceHidden] = useState(false);
  const [walletDropdownOpen, setWalletDropdownOpen] = useState(false);
  const [settingsDropdownOpen, setSettingsDropdownOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [copiedAddress, setCopiedAddress] = useState(false);
  const [isConnected, setIsConnected] = useState(true);

  const headerRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [isTransactionsStuck, setIsTransactionsStuck] = useState(false);

  useLayoutEffect(() => {
    const el = headerRef.current;
    const container = scrollContainerRef.current;
    const updateHeaderHeight = () => {
      const h = el?.offsetHeight ?? 0;
      container?.style.setProperty('--header-h', `${h}px`);
    };
    updateHeaderHeight();
    window.addEventListener('resize', updateHeaderHeight);
    return () => window.removeEventListener('resize', updateHeaderHeight);
  }, []);

  // Detect when transactions section is stuck at top
  useLayoutEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const headerHeight = headerRef.current?.offsetHeight ?? 64;
      const balanceSectionHeight = 140;
      // When scrolled past the balance section, snap to full width
      const isStuck = container.scrollTop >= balanceSectionHeight;
      setIsTransactionsStuck(isStuck);
    };

    container.addEventListener('scroll', handleScroll);
    handleScroll(); // Call once on mount
    return () => container.removeEventListener('scroll', handleScroll);
  }, []);

  // Fetch cached transactions on mount and when account changes
  useEffect(() => {
    console.log(
      '[HomeScreen] Fetching cached transactions for account:',
      wallet.currentAccount?.address
    );
    fetchCachedTransactions();
  }, [fetchCachedTransactions, wallet.currentAccount?.address]);

  // Debug: Log cached transactions when they change
  useEffect(() => {
    console.log('[HomeScreen] Cached transactions updated:', cachedTransactions);
  }, [cachedTransactions]);

  // Poll RPC connection status
  useEffect(() => {
    async function checkConnection() {
      const result = await send<{ connected?: boolean }>(
        INTERNAL_METHODS.GET_CONNECTION_STATUS,
        []
      );
      setIsConnected(result?.connected ?? true);
    }

    checkConnection(); // Initial check
    const interval = setInterval(checkConnection, 5000); // Check every 5 seconds
    return () => clearInterval(interval);
  }, []);

  // Get accounts from vault (filter out hidden accounts)
  const accounts = (wallet.accounts || []).filter(acc => !acc.hidden);
  const currentAccount = wallet.currentAccount || accounts[0];

  // Lock wallet handler
  async function handleLockWallet() {
    const result = await send<{ ok?: boolean }>(INTERNAL_METHODS.LOCK, []);

    if (result?.ok) {
      syncWallet({
        ...wallet,
        locked: true,
      });
      navigate('locked');
    }
  }

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

      // Fetch balance for the switched account
      fetchBalance();
      fetchCachedTransactions();
    }

    setWalletDropdownOpen(false);
  }

  // Account creation handler
  async function handleAddAccount() {
    const result = await send<{ ok?: boolean; account?: Account; error?: string }>(
      INTERNAL_METHODS.CREATE_ACCOUNT,
      []
    );

    if (result?.ok && result.account) {
      const updatedWallet = {
        ...wallet,
        accounts: [...wallet.accounts, result.account],
        currentAccount: result.account,
        address: result.account.address,
        balance: 0, // Reset balance to 0 for new account
        accountBalances: {
          ...wallet.accountBalances,
          [result.account.address]: 0, // Initialize new account balance to 0
        },
      };
      syncWallet(updatedWallet);

      // Fetch balance for the newly created account
      console.log('[HomeScreen] Fetching balance for newly created account...');
      fetchBalance();
    } else if (result?.error) {
      console.log(`[HomeScreen] Failed to create account: ${result.error}`);
    }

    setWalletDropdownOpen(false);
  }

  // Refresh balance handler
  async function handleRefreshBalance() {
    setIsRefreshing(true);
    try {
      await fetchBalance();

      // Check status of pending transactions (only last 3 to avoid rate limits)
      if (pendingTransactions.length > 0) {
        const recentPending = pendingTransactions.slice(-3); // Only check last 3
        console.log(
          `[HomeScreen] Checking status of ${recentPending.length} most recent pending transactions...`
        );
        const { createBrowserClient } = await import('../../shared/rpc-client-browser');
        const rpcClient = createBrowserClient();

        for (const tx of recentPending) {
          console.log(`[HomeScreen] Checking transaction ${tx.txid.slice(0, 20)}...`);
          try {
            const accepted = await rpcClient.isTransactionAccepted(tx.txid);
            console.log(
              `[HomeScreen] Transaction ${tx.txid.slice(0, 20)}... accepted: ${accepted}`
            );

            if (accepted) {
              // Transaction was accepted - mark as confirmed
              await updateTransactionStatus(tx.txid, 'confirmed');
              console.log(`[HomeScreen] Marked transaction as confirmed`);
            } else {
              // Transaction was rejected - mark as failed
              await updateTransactionStatus(tx.txid, 'failed');
              console.log(`[HomeScreen] Marked transaction as failed (rejected by mempool)`);
            }
          } catch (error) {
            console.error(
              `[HomeScreen] Error checking transaction ${tx.txid.slice(0, 20)}:`,
              error
            );
          }
        }
      }
    } finally {
      setIsRefreshing(false);
    }
  }

  // Get pending transactions (used in refresh handler)
  const pendingTransactions = cachedTransactions.filter(tx => tx.status === 'pending');

  const balance = wallet.balance.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  // Calculate USD value based on balance and price
  const totalBalanceUsd = wallet.balance * priceUsd;
  const formattedUsdValue = totalBalanceUsd.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const formattedPercentChange = Math.abs(priceChange24h).toFixed(2);

  const walletName = currentAccount?.name || 'Wallet';

  // Fetch price on mount and when account changes
  useEffect(() => {
    fetchPrice();
  }, [fetchPrice]);
  const walletAddress = truncateAddress(currentAccount?.address);
  const fullAddress = currentAccount?.address || '';

  // Group cached transactions by date
  const transactionsByDate = cachedTransactions.reduce(
    (acc, tx) => {
      const date = new Date(tx.timestamp).toLocaleDateString('en-US', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });

      if (!acc[date]) {
        acc[date] = [];
      }

      acc[date].push({
        type: tx.type,
        from: truncateAddress(tx.address),
        amount:
          tx.type === 'sent'
            ? `-${tx.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} NOCK`
            : `${tx.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} NOCK`,
        usdValue: `$${(tx.amount * priceUsd).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        status: tx.status,
        txid: tx.txid,
        originalTx: tx, // Keep reference to original transaction
      });

      return acc;
    },
    {} as Record<string, any[]>
  );

  const transactions = Object.entries(transactionsByDate).map(([date, items]) => ({
    date,
    items,
  }));

  return (
    <div
      className="w-[357px] h-[600px] overflow-hidden relative"
      style={{ backgroundColor: 'var(--color-home-fill)', color: 'var(--color-text-primary)' }}
    >
      {/* Scroll container */}
      <div
        ref={scrollContainerRef}
        className="relative h-full overflow-y-auto scroll-thin flex flex-col"
      >
        {/* Sticky header */}
        <header
          ref={headerRef}
          className="sticky top-0 z-40 backdrop-blur"
          style={{ backgroundColor: 'var(--color-home-fill)' }}
        >
          <div className="px-4 py-3 flex items-center justify-between min-h-[64px]">
            <button
              className="flex items-center gap-2"
              onClick={() => setWalletDropdownOpen(o => !o)}
              aria-label="Wallet menu"
            >
              <div
                className="relative h-10 w-10 rounded-tile grid place-items-center"
                style={{ backgroundColor: 'var(--color-bg)' }}
              >
                <AccountIcon
                  styleId={currentAccount?.iconStyleId}
                  color={currentAccount?.iconColor}
                  className="h-6 w-6"
                />
                <div
                  className="absolute -bottom-px -right-0.5 h-2 w-2 rounded-full"
                  style={{
                    backgroundColor: isConnected ? 'var(--color-green)' : 'var(--color-red)',
                  }}
                  title={isConnected ? 'Connected' : 'Disconnected'}
                />
              </div>
              <div className="flex flex-col min-w-0">
                <div
                  className="font-sans text-[14px] font-medium leading-[18px] tracking-[0.14px] flex items-center gap-1"
                  style={{ color: 'var(--color-text-primary)' }}
                >
                  {walletName}
                  <img src={WalletDropdownArrow} alt="" className="h-3 w-3" />
                </div>
                <div
                  className="font-sans text-[13px] leading-[18px] tracking-[0.26px] flex items-center gap-2"
                  style={{ color: 'var(--color-text-muted)' }}
                >
                  <span className="truncate">{walletAddress}</span>
                  <button
                    className="shrink-0 opacity-70 hover:opacity-40"
                    onClick={async e => {
                      e.stopPropagation();
                      try {
                        await navigator.clipboard.writeText(fullAddress);
                        setCopiedAddress(true);
                        setTimeout(() => setCopiedAddress(false), 2000);
                      } catch (err) {
                        console.error('Failed to copy address:', err);
                      }
                    }}
                    aria-label="Copy address"
                  >
                    {copiedAddress ? (
                      <CheckIcon className="h-3 w-3" />
                    ) : (
                      <img src={CopyIcon} alt="" className="h-3 w-3" />
                    )}
                  </button>
                </div>
              </div>
            </button>

            <div className="flex items-center gap-2">
              <button
                className="h-8 w-8 rounded-tile hover:bg-black/5 grid place-items-center"
                onClick={handleLockWallet}
              >
                <img src={LockIconAsset} alt="Lock" className="h-5 w-5" />
              </button>
              <button
                className="h-8 w-8 rounded-tile hover:bg-black/5 grid place-items-center"
                onClick={() => setSettingsDropdownOpen(o => !o)}
              >
                <img src={SettingsIconAsset} alt="Settings" className="h-5 w-5" />
              </button>
            </div>
          </div>
        </header>

        {/* Wallet dropdown */}
        {walletDropdownOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setWalletDropdownOpen(false)} />
            <div
              className="fixed top-[64px] left-2 right-2 rounded-xl z-50 max-h-[400px] overflow-y-auto"
              style={{
                backgroundColor: 'var(--color-bg)',
                border: '1px solid var(--color-surface-700)',
                boxShadow: '0 4px 12px 0 rgba(5, 5, 5, 0.12)',
              }}
            >
              <div className="p-2">
                {accounts.map(account => {
                  const isSelected = currentAccount?.index === account.index;
                  const showSelection = accounts.length > 1 && isSelected;
                  return (
                    <button
                      key={account.index}
                      onClick={() => handleSwitchAccount(account.index)}
                      className="wallet-dropdown-item w-full flex items-center gap-2 p-2 rounded-tile border transition"
                      style={{
                        backgroundColor: showSelection ? 'var(--color-bg)' : 'transparent',
                        borderColor: showSelection ? 'var(--color-text-primary)' : 'transparent',
                      }}
                      onMouseEnter={e => {
                        if (!showSelection) {
                          e.currentTarget.style.backgroundColor = 'var(--color-surface-900)';
                        }
                      }}
                      onMouseLeave={e => {
                        if (!showSelection) {
                          e.currentTarget.style.backgroundColor = showSelection
                            ? 'var(--color-bg)'
                            : 'transparent';
                        }
                      }}
                    >
                      <div
                        className="h-10 w-10 rounded-tile grid place-items-center"
                        style={{ backgroundColor: 'var(--color-bg)' }}
                      >
                        <AccountIcon
                          styleId={account.iconStyleId}
                          color={account.iconColor}
                          className="h-6 w-6"
                        />
                      </div>
                      <div className="flex-1 text-left">
                        <div
                          className="text-[14px] leading-[18px] font-medium"
                          style={{ color: 'var(--color-text-primary)' }}
                        >
                          {account.name}
                        </div>
                        <div
                          className="text-[13px] leading-[18px] tracking-[0.26px]"
                          style={{ color: 'var(--color-text-muted)' }}
                        >
                          {truncateAddress(account.address)}
                        </div>
                      </div>
                      <div
                        className="wallet-balance text-[14px] font-medium whitespace-nowrap"
                        style={{ color: 'var(--color-text-primary)' }}
                      >
                        {(wallet.accountBalances[account.address] ?? 0).toLocaleString('en-US', {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}{' '}
                        NOCK
                      </div>
                      <div
                        className="wallet-settings-icon h-10 w-10 rounded-tile hidden items-center justify-center"
                        style={{ backgroundColor: 'var(--color-surface-700)' }}
                        onClick={e => {
                          e.stopPropagation();
                          setWalletDropdownOpen(false);
                          navigate('wallet-settings');
                        }}
                      >
                        <img src={PencilEditIcon} alt="Edit wallet" className="h-5 w-5" />
                      </div>
                    </button>
                  );
                })}
              </div>
              <div className="h-px" style={{ backgroundColor: 'var(--color-divider)' }} />
              <div className="p-2">
                <button
                  className="w-full h-12 font-medium rounded-lg"
                  style={{ backgroundColor: 'var(--color-text-primary)', color: 'var(--color-bg)' }}
                  onClick={handleAddAccount}
                >
                  Add Wallet
                </button>
              </div>
            </div>
          </>
        )}

        {/* Settings dropdown */}
        {settingsDropdownOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setSettingsDropdownOpen(false)} />
            <div
              className="fixed top-[64px] right-2 w-[245px] rounded-xl p-2 z-50 flex flex-col gap-1"
              style={{
                backgroundColor: 'var(--color-bg)',
                border: '1px solid var(--color-surface-700)',
                boxShadow: '0 4px 12px 0 rgba(5, 5, 5, 0.12)',
              }}
            >
              <DropdownItem
                icon={ExplorerIcon}
                label="View on explorer"
                onClick={() =>
                  window.open(`https://nockscan.net/address/${currentAccount?.address}`, '_blank')
                }
              />
              <DropdownItem
                icon={PermissionsIcon}
                label="Wallet permissions"
                onClick={() => {
                  setSettingsDropdownOpen(false);
                  navigate('wallet-permissions');
                }}
              />
              <DropdownItem
                icon={SettingsIconAsset}
                label="Settings"
                onClick={() => {
                  setSettingsDropdownOpen(false);
                  navigate('settings');
                }}
              />
              <div className="h-px my-1" style={{ backgroundColor: 'var(--color-divider)' }} />
              <DropdownItem
                icon={FeedbackIcon}
                label="Wallet feedback"
                onClick={() => window.open('https://iriswallet.io/feedback', '_blank')}
              />
            </div>
          </>
        )}

        {/* Sticky balance block (lower z) */}
        <div
          className="sticky top-[var(--header-h)] z-10 px-4 pt-1"
          style={{ backgroundColor: 'var(--color-home-fill)' }}
        >
          <div className="mb-3">
            <div className="flex items-baseline gap-[6px]">
              {isBalanceFetching ? (
                <div className="flex items-baseline gap-[6px]">
                  <div className="h-[40px] w-32 rounded skeleton-shimmer" />
                  <div className="h-[28px] w-16 rounded skeleton-shimmer" />
                </div>
              ) : (
                <>
                  <div
                    className="font-display font-semibold text-[36px] leading-[40px] tracking-[-0.72px]"
                    style={{ color: 'var(--color-text-primary)' }}
                  >
                    {balanceHidden ? '••••••' : balance}
                  </div>
                  <div
                    className="font-display text-[24px] leading-[28px] tracking-[-0.48px]"
                    style={{ color: 'var(--color-text-muted)' }}
                  >
                    NOCK
                  </div>
                </>
              )}
              <button
                className="ml-1"
                style={{ color: 'var(--color-text-muted)' }}
                onClick={() => setBalanceHidden(b => !b)}
                aria-label="Toggle balance visibility"
              >
                {balanceHidden ? (
                  <EyeOffIcon className="h-4 w-4" />
                ) : (
                  <EyeIcon className="h-4 w-4" />
                )}
              </button>
              <button
                className="ml-1"
                style={{ color: 'var(--color-text-muted)' }}
                onClick={handleRefreshBalance}
                disabled={isRefreshing}
                aria-label="Refresh balance"
              >
                <img
                  src={RefreshIcon}
                  alt="Refresh"
                  className="h-4 w-4"
                  style={{
                    opacity: isRefreshing ? 0.5 : 1,
                    transform: isRefreshing ? 'rotate(360deg)' : 'rotate(0deg)',
                    transition: 'transform 0.6s ease-in-out',
                  }}
                />
              </button>
            </div>
            <div className="mt-1 text-[13px] font-medium leading-[18px] flex items-center gap-1">
              {isPriceFetching ? (
                <div className="h-[14px] w-36 rounded skeleton-shimmer" />
              ) : (
                <>
                  <img
                    src={priceChange24h >= 0 ? TrendUpArrow : TrendDownArrow}
                    alt={priceChange24h >= 0 ? 'up' : 'down'}
                    className="h-4 w-4"
                  />
                  <span
                    style={{
                      color: priceChange24h >= 0 ? 'var(--color-green)' : 'var(--color-red)',
                    }}
                  >
                    {balanceHidden
                      ? '••••• •••••'
                      : `$${formattedUsdValue} (${priceChange24h >= 0 ? '+' : '-'}${formattedPercentChange}%)`}
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="grid grid-cols-2 gap-2 mb-3">
            <button
              className="rounded-card shadow-card flex flex-col items-start justify-center gap-4 p-3 font-sans text-[14px] font-medium transition-all hover:opacity-90 active:scale-[0.98]"
              style={{ backgroundColor: 'var(--color-primary)', color: '#000' }}
              onClick={() => navigate('send')}
            >
              <SendPaperPlaneIcon className="h-5 w-5" />
              Send
            </button>
            <button
              className="rounded-card shadow-card flex flex-col items-start justify-center gap-4 p-3 font-sans text-[14px] font-medium transition-all hover:opacity-90 active:scale-[0.98]"
              style={{
                backgroundColor: 'var(--color-home-accent)',
                color: 'var(--color-text-primary)',
              }}
              onClick={() => navigate('receive')}
            >
              <ReceiveCircleIcon className="h-5 w-5" />
              Receive
            </button>
          </div>
        </div>

        <section
          className={`relative z-20 shadow-card rounded-t-xl transition-all duration-300 flex-1 flex flex-col ${
            isTransactionsStuck ? '' : 'mx-2 mt-4'
          }`}
          style={{
            backgroundColor: 'var(--color-home-accent)',
            border: '1px solid var(--color-divider)',
          }}
        >
          {/* Sticky header inside the sheet (matches scroll state 2) */}
          <div
            className="sticky top-[var(--header-h)] z-10 px-4 py-3 rounded-t-xl"
            style={{
              backgroundColor: 'var(--color-home-accent)',
              borderBottom: '1px solid var(--color-divider)',
            }}
          >
            <div className="flex items-center justify-between">
              <h2
                className="font-display text-[14px] font-medium"
                style={{ color: 'var(--color-text-primary)' }}
              >
                Recent Transactions
              </h2>
              <a
                href="https://nockscan.net/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[12px] font-medium rounded-full pl-[12px] pr-[16px] py-[3px] flex items-center gap-[4px] transition-opacity"
                style={{
                  border: '1px solid var(--color-text-primary)',
                  color: 'var(--color-text-primary)',
                }}
                onMouseEnter={e => (e.currentTarget.style.opacity = '0.7')}
                onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
              >
                <ArrowUpRightIcon className="h-[10px] w-[10px]" />
                View all
              </a>
            </div>
          </div>

          {/* Groups */}
          <div className="px-4 pb-6 flex-1 flex flex-col">
            {cachedTransactions.length === 0 ? (
              /* Empty state */
              <div className="flex flex-col items-center justify-center gap-2 flex-1">
                <div
                  className="h-10 w-10 rounded-full flex items-center justify-center"
                  style={{ backgroundColor: 'var(--color-tx-icon)' }}
                >
                  <img src={ReceiptIcon} alt="" className="h-5 w-5" />
                </div>
                <div className="text-center">
                  <p
                    className="font-display font-medium text-[14px] leading-[18px] tracking-[0.14px] m-0"
                    style={{ color: 'var(--color-text-muted)' }}
                  >
                    No activity yet.
                  </p>
                  <p
                    className="font-display font-medium text-[14px] leading-[18px] tracking-[0.14px] m-0"
                    style={{ color: 'var(--color-text-muted)' }}
                  >
                    Make your first NOCK transaction.
                  </p>
                </div>
              </div>
            ) : (
              transactions.map((group, idx) => (
                <div
                  key={idx}
                  className={idx === 0 ? 'pt-4' : 'pt-4'}
                  style={idx !== 0 ? { borderTop: '1px solid var(--color-divider)' } : undefined}
                >
                  <div
                    className="font-display font-medium text-[14px] leading-[18px] tracking-[0.14px] mb-3"
                    style={{ color: 'var(--color-text-muted)' }}
                  >
                    {group.date}
                  </div>
                  <div>
                    {group.items.map((t, i) => (
                      <button
                        key={i}
                        className="w-full flex items-start gap-3 py-3 rounded-lg px-2 -mx-2"
                        onClick={() => {
                          setSelectedTransaction(t.originalTx);
                          navigate('tx-details');
                        }}
                      >
                        <div
                          className="h-10 w-10 shrink-0 rounded-full grid place-items-center"
                          style={{ backgroundColor: 'var(--color-tx-icon)' }}
                        >
                          {t.type === 'received' ? (
                            <ReceiveArrowIcon
                              className="h-4 w-4"
                              style={{ color: 'var(--color-text-muted)' }}
                            />
                          ) : (
                            <SentArrowIcon
                              className="h-4 w-4"
                              style={{ color: 'var(--color-text-muted)' }}
                            />
                          )}
                        </div>
                        <div className="flex-1 text-left">
                          <div
                            className="text-[14px] font-medium"
                            style={{ color: 'var(--color-text-primary)' }}
                          >
                            {t.type === 'received' ? 'Received' : 'Sent'}
                          </div>
                          <div
                            className="text-[12px] flex items-center gap-1.5"
                            style={{ color: 'var(--color-text-muted)' }}
                          >
                            {t.status === 'pending' && (
                              <>
                                <span style={{ color: '#C88414' }}>Pending</span>
                                <span>·</span>
                              </>
                            )}
                            {t.status === 'failed' && (
                              <>
                                <span style={{ color: 'var(--color-red)' }}>Failed</span>
                                <span>·</span>
                              </>
                            )}
                            <span>{t.from}</span>
                          </div>
                        </div>
                        <div className="text-right">
                          <div
                            className="text-[14px] font-medium whitespace-nowrap"
                            style={{
                              color:
                                t.type === 'received'
                                  ? 'var(--color-green)'
                                  : 'var(--color-text-primary)',
                            }}
                          >
                            {t.amount}
                          </div>
                          <div
                            className="text-[12px] whitespace-nowrap"
                            style={{ color: 'var(--color-text-muted)' }}
                          >
                            {t.usdValue}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function DropdownItem({
  icon,
  label,
  onClick,
}: {
  icon: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-2 p-2 rounded-lg text-left transition-colors"
      style={{ backgroundColor: 'transparent' }}
      onMouseEnter={e => {
        e.currentTarget.style.backgroundColor = 'var(--color-surface-900)';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.backgroundColor = 'transparent';
      }}
    >
      <div
        className="h-8 w-8 rounded-tile grid place-items-center"
        style={{ backgroundColor: 'var(--color-surface-800)' }}
      >
        <img src={icon} className="h-5 w-5" alt="" />
      </div>
      <span className="text-[14px] font-medium" style={{ color: 'var(--color-text-primary)' }}>
        {label}
      </span>
    </button>
  );
}
