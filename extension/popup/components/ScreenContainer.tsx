/**
 * ScreenContainer - Consistent container for all popup screens
 */

import { ReactNode } from 'react';

interface ScreenContainerProps {
  children: ReactNode;
  className?: string;
}

export function ScreenContainer({ children, className = '' }: ScreenContainerProps) {
  const baseClasses = 'w-full h-full p-4';
  const combinedClasses = className ? `${baseClasses} ${className}` : baseClasses;

  return <div className={combinedClasses}>{children}</div>;
}
