/**
 * ChevronDownIcon - Dropdown arrow icon
 */

interface IconProps {
  className?: string;
  style?: React.CSSProperties;
}

export function ChevronDownIcon({ className = 'w-5 h-5', style }: IconProps) {
  return (
    <svg className={className} style={style} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  );
}
