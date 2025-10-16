/**
 * useCopyToClipboard - Copy text to clipboard with state management
 *
 * @returns Object with copied state and copyToClipboard function
 *
 */

import { useState } from "react";

interface UseCopyToClipboardReturn {
  /** Whether text was recently copied (resets after 2 seconds) */
  copied: boolean;
  /** Copy text to clipboard */
  copyToClipboard: (text: string) => Promise<void>;
}

export function useCopyToClipboard(): UseCopyToClipboardReturn {
  const [copied, setCopied] = useState(false);

  async function copyToClipboard(text: string) {
    if (!text) return;

    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy to clipboard:", err);
    }
  }

  return { copied, copyToClipboard };
}
