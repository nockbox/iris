/**
 * SiteIcon - Display site favicon with fallback to letter avatar
 */

import { useFavicon } from '../hooks/useFavicon';

interface SiteIconProps {
  origin: string;
  domain: string;
  size?: 'sm' | 'md' | 'lg';
}

export function SiteIcon({ origin, domain, size = 'lg' }: SiteIconProps) {
  const faviconUrl = useFavicon(origin);

  // Size mappings
  const sizeClasses = {
    sm: 'w-8 h-8',
    md: 'w-12 h-12',
    lg: 'w-16 h-16',
  };

  const textSizes = {
    sm: 'text-lg',
    md: 'text-xl',
    lg: 'text-2xl',
  };

  const surface = 'var(--color-surface-800)';
  const textPrimary = 'var(--color-text-primary)';

  return (
    <div className="relative inline-block">
      <div
        className={`inline-flex items-center justify-center rounded-full ${sizeClasses[size]} overflow-hidden`}
        style={{ backgroundColor: surface }}
      >
        {faviconUrl ? (
          <img
            src={faviconUrl}
            alt={`${domain} favicon`}
            className="w-full h-full object-cover"
            onError={e => {
              // Hide broken image, show letter fallback
              e.currentTarget.style.display = 'none';
              const parent = e.currentTarget.parentElement;
              if (parent) {
                parent.innerHTML = `<span class="${textSizes[size]} font-bold" style="color: ${textPrimary}">${domain.charAt(0).toUpperCase()}</span>`;
              }
            }}
          />
        ) : (
          <span className={`${textSizes[size]} font-bold`} style={{ color: textPrimary }}>
            {domain.charAt(0).toUpperCase()}
          </span>
        )}
      </div>
    </div>
  );
}
