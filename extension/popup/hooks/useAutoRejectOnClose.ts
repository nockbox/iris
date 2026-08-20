/**
 * useAutoRejectOnClose - Auto-reject approval requests when window closes
 *
 * This hook automatically rejects pending approval requests when the user closes
 * the popup window without taking action.
 *
 * @param requestId - The ID of the pending approval request
 * @param rejectMethod - The internal method to call for rejection
 */

import { useEffect } from 'react';
import { send } from '../utils/messaging';

export function useAutoRejectOnClose(requestId: string | null, rejectMethod: string) {
  useEffect(() => {
    if (!requestId) {
      return;
    }

    const handleBeforeUnload = () => {
      // Reject the request when window is closing
      send(rejectMethod, [requestId]).catch(console.error);
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [requestId, rejectMethod]);
}
