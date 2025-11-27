/**
 * SiteIcon - Display site favicon with fallback to letter avatar
 * Shows SSL/HTTPS indicator for secure connections
 */

import { useFavicon } from '../hooks/useFavicon';
import { LockIcon } from './icons/LockIcon';

interface SiteIconProps {
  origin: string;
  domain: string;
  size?: 'sm' | 'md' | 'lg';
  showSSL?: boolean;
}

export function SiteIcon({ origin, domain, size = 'lg', showSSL = true }: SiteIconProps) {
  const faviconUrl = useFavicon(origin);
  const isSecure = origin.startsWith('https://');

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

  const sslSizes = {
    sm: 'w-3 h-3',
    md: 'w-3.5 h-3.5',
    lg: 'w-4 h-4',
  };

  const surface = 'var(--color-surface-800)';
  const textPrimary = 'var(--color-text-primary)';
  const green = 'var(--color-green)';

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

      {/* SSL/HTTPS Indicator */}
      {showSSL && isSecure && (
        <div
          className={`absolute -bottom-0.5 -right-0.5 ${sslSizes[size]} rounded-full flex items-center justify-center`}
          style={{ backgroundColor: green }}
          title="Secure HTTPS connection"
        >
          <LockIcon className="w-2/3 h-2/3 text-white" />
        </div>
      )}
    </div>
  );
}
