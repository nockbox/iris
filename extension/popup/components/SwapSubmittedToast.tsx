/**
 * SwapSubmittedToast - Pill-shaped toast that drops down briefly and disappears.
 * Figma: white bg, grey border, shadow, check icon + "Swap submitted"
 */

import { useEffect } from 'react';
import { useStore } from '../store';
import { CheckIcon } from './icons/CheckIcon';

const TOAST_DURATION_MS = 3000;

export function SwapSubmittedToast() {
  const { swapSubmittedToastVisible, setSwapSubmittedToastVisible } = useStore();

  useEffect(() => {
    if (!swapSubmittedToastVisible) return;
    const t = setTimeout(() => setSwapSubmittedToastVisible(false), TOAST_DURATION_MS);
    return () => clearTimeout(t);
  }, [swapSubmittedToastVisible, setSwapSubmittedToastVisible]);

  if (!swapSubmittedToastVisible) return null;

  return (
    <div className="fixed inset-x-0 top-4 z-50 flex justify-center">
      <div
        className="flex items-center justify-center gap-2 rounded-full px-4 py-3 animate-toast-slide-down"
        style={{
          backgroundColor: '#ffffff',
          border: '1px solid var(--color-surface-700)',
          boxShadow: '0px 4px 12px 0px rgba(5, 5, 5, 0.12)',
          color: '#000000',
        }}
      >
        <div
          className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full"
          style={{ backgroundColor: 'var(--color-primary)' }}
        >
          <CheckIcon className="h-2.5 w-2.5" style={{ color: '#FFF' }} />
        </div>
        <span
          className="text-[14px] font-medium"
          style={{ letterSpacing: '0.14px', lineHeight: '18px' }}
        >
          Swap submitted
        </span>
      </div>
    </div>
  );
}
