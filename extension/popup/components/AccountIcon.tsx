import { useEffect, useState } from 'react';

import { DEFAULT_WALLET_STYLE, normalizeIconStyleId } from '../../shared/walletStyles';
import { WALLET_ICON_ASSETS } from './walletIconAssets';

interface AccountIconProps {
  /** Icon style id (slug; legacy numeric ids are mapped automatically) */
  styleId?: number | string;
  /** Icon color (hex string) */
  color?: string;
  /** CSS class names */
  className?: string;
}

/**
 * Displays an account icon with custom style and color
 * Fetches the SVG and applies the color dynamically
 */
export function AccountIcon({
  styleId,
  color = DEFAULT_WALLET_STYLE.iconColor,
  className = 'h-6 w-6',
}: AccountIconProps) {
  const [svgContent, setSvgContent] = useState<string>('');

  const iconId = normalizeIconStyleId(styleId);

  useEffect(() => {
    const asset = WALLET_ICON_ASSETS[iconId];

    fetch(asset)
      .then(res => res.text())
      .then(text => {
        // Replace CSS var `--fill-0` with the chosen color
        const modifiedSvg = text.replace(/var\(--fill-0,\s*#[A-Fa-f0-9]{6}\)/g, color);
        setSvgContent(modifiedSvg);
      })
      .catch(err => {
        console.error('Failed to load SVG:', err);
        // Fallback: just use the default without color
        setSvgContent(
          `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="${color}"/></svg>`
        );
      });
  }, [iconId, color]);

  return <div className={className} dangerouslySetInnerHTML={{ __html: svgContent }} />;
}
