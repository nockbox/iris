/**
 * useFavicon - Fetch and cache website favicon
 *
 * Attempts to load favicon from origin's /favicon.ico
 * Falls back to null if not found (triggers letter avatar fallback)
 *
 * Note: We intentionally don't use Google's favicon service because
 * it returns a generic globe icon for unknown sites, which looks worse
 * than a clean letter avatar.
 */

import { useState, useEffect } from 'react';

export function useFavicon(origin: string): string | null {
  const [faviconUrl, setFaviconUrl] = useState<string | null>(null);

  useEffect(() => {
    // Only fetch for http/https origins
    if (!origin.startsWith('http://') && !origin.startsWith('https://')) {
      setFaviconUrl(null);
      return;
    }

    let isCancelled = false;

    async function loadFavicon() {
      try {
        const url = new URL(origin);
        const domain = url.origin;

        // Try direct favicon.ico
        const directFavicon = `${domain}/favicon.ico`;

        // Test if image loads successfully
        const img = new Image();
        img.onload = () => {
          if (!isCancelled) {
            setFaviconUrl(directFavicon);
          }
        };
        img.onerror = () => {
          // No favicon found - fall back to null (letter avatar)
          if (!isCancelled) {
            setFaviconUrl(null);
          }
        };
        img.src = directFavicon;
      } catch (err) {
        // Invalid URL or other error - no favicon
        if (!isCancelled) {
          setFaviconUrl(null);
        }
      }
    }

    loadFavicon();

    return () => {
      isCancelled = true;
    };
  }, [origin]);

  return faviconUrl;
}
