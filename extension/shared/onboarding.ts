/**
 * Onboarding State Management
 * Handles persisting and retrieving onboarding progress to ensure users
 * complete their secret phrase backup even if they close the popup mid-flow.
 */

import { STORAGE_KEYS } from './constants';

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null;
}

/**
 * Onboarding state stored in chrome.storage.local
 */
export interface OnboardingState {
  /** Whether secret phrase backup has been completed */
  completed: boolean;
  /** Current onboarding step (only present if not completed) */
  step?: 'backup' | 'verify';
}

/**
 * Set the onboarding state to in-progress at the backup step
 * Called when a new wallet is created
 */
export async function setOnboardingInProgress(): Promise<void> {
  const state: OnboardingState = {
    completed: false,
    step: 'backup',
  };
  await chrome.storage.local.set({ [STORAGE_KEYS.ONBOARDING_STATE]: state });
}

/**
 * Mark onboarding as complete
 * Called when user successfully verifies their secret phrase
 */
export async function markOnboardingComplete(): Promise<void> {
  const state: OnboardingState = {
    completed: true,
  };
  await chrome.storage.local.set({ [STORAGE_KEYS.ONBOARDING_STATE]: state });
}

/**
 * Get current onboarding state
 * Returns null if no onboarding state exists (fresh install or pre-migration)
 */
export async function getOnboardingState(): Promise<OnboardingState | null> {
  const result = (await chrome.storage.local.get([STORAGE_KEYS.ONBOARDING_STATE])) as Record<
    string,
    unknown
  >;
  const raw = result[STORAGE_KEYS.ONBOARDING_STATE];
  if (!isRecord(raw)) return null;
  if (typeof raw.completed !== 'boolean') return null;
  const step = raw.step;
  if (step === 'backup' || step === 'verify') return { completed: raw.completed, step };
  if (step === undefined) return { completed: raw.completed };
  return null;
}

/**
 * Check if user has incomplete onboarding (created wallet but didn't complete backup)
 */
export async function hasIncompleteOnboarding(): Promise<boolean> {
  const state = await getOnboardingState();
  return state !== null && !state.completed;
}

/**
 * Clear onboarding state
 * Used if user explicitly skips backup (not recommended) or for cleanup
 */
export async function clearOnboardingState(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEYS.ONBOARDING_STATE);
}
