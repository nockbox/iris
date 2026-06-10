import { useState, useEffect } from 'react';
import { useStore } from '../store';
import { send } from '../utils/messaging';
import { INTERNAL_METHODS } from '../../shared/constants';
import { ChevronLeftIcon } from '../components/icons/ChevronLeftIcon';

type LockTimeOption = '1min' | '5min' | '10min' | '15min' | '30min' | '1hour' | '4hours' | 'never';

// Conversion helpers
function minutesToOption(minutes: number): LockTimeOption {
  if (minutes === 1) return '1min';
  if (minutes === 5) return '5min';
  if (minutes === 10) return '10min';
  if (minutes === 15) return '15min';
  if (minutes === 30) return '30min';
  if (minutes === 60) return '1hour';
  if (minutes === 240) return '4hours';
  if (minutes === 0) return 'never';
  return '15min'; // default
}

function optionToMinutes(option: LockTimeOption): number {
  switch (option) {
    case '1min':
      return 1;
    case '5min':
      return 5;
    case '10min':
      return 10;
    case '15min':
      return 15;
    case '30min':
      return 30;
    case '1hour':
      return 60;
    case '4hours':
      return 240;
    case 'never':
      return 0;
    default:
      return 15;
  }
}

/**
 * LockTimeScreen - Lock time settings screen
 * Allows users to set the auto-lock timeout duration
 */
export function LockTimeScreen() {
  const { navigate } = useStore();
  const [selectedTime, setSelectedTime] = useState<LockTimeOption>('15min');

  // Load current lock time setting on mount
  useEffect(() => {
    (async () => {
      const result = await send<{ minutes?: number }>(INTERNAL_METHODS.GET_AUTO_LOCK);
      if (result?.minutes !== undefined) {
        setSelectedTime(minutesToOption(result.minutes));
      }
    })();
  }, []);

  function handleBack() {
    navigate('settings');
  }

  async function handleTimeSelect(time: LockTimeOption) {
    setSelectedTime(time);

    // Convert to minutes and persist to backend
    const minutes = optionToMinutes(time);
    await send(INTERNAL_METHODS.SET_AUTO_LOCK, [minutes]);
  }

  const timeOptions: { value: LockTimeOption; label: string }[] = [
    { value: '1min', label: '1 minute' },
    { value: '5min', label: '5 minutes' },
    { value: '10min', label: '10 minutes' },
    { value: '15min', label: '15 minutes' },
    { value: '30min', label: '30 minutes' },
    { value: '1hour', label: '1 hour' },
    { value: '4hours', label: '4 hours' },
    { value: 'never', label: 'Never' },
  ];

  return (
    <div
      className="w-full h-full flex flex-col overflow-y-auto"
      style={{ backgroundColor: 'var(--color-bg)', color: 'var(--color-text-primary)' }}
    >
      {/* Header */}
      <header
        className="flex items-center justify-between px-4 py-3 min-h-[64px]"
        style={{ backgroundColor: 'var(--color-bg)' }}
      >
        <button
          type="button"
          onClick={handleBack}
          aria-label="Back"
          className="w-8 h-8 p-2 flex items-center justify-center rounded-lg transition-colors focus:outline-none focus-visible:ring-2"
          style={{ color: 'var(--color-text-primary)' }}
          onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--color-surface-800)')}
          onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
        >
          <ChevronLeftIcon className="w-5 h-5" />
        </button>

        <h1 className="m-0 text-base font-medium leading-[22px] tracking-[0.16px]">Lock time</h1>

        <div className="w-8 h-8" />
      </header>

      {/* Time Options */}
      <div className="flex flex-col gap-2 px-3 py-2">
        {timeOptions.map(option => {
          const selected = selectedTime === option.value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => handleTimeSelect(option.value)}
              className="flex items-center justify-between p-3 rounded-lg text-left transition-colors focus:outline-none focus-visible:ring-2"
              onMouseEnter={e =>
                (e.currentTarget.style.backgroundColor = 'var(--color-surface-800)')
              }
              onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
              role="radio"
              aria-checked={selected}
            >
              <span className="text-sm font-medium leading-[18px] tracking-[0.14px]">
                {option.label}
              </span>

              {/* Radio */}
              <span
                className="w-5 h-5 rounded-full flex items-center justify-center transition-colors"
                style={{
                  border: `2px solid ${selected ? 'var(--color-primary)' : 'var(--color-surface-700)'}`,
                }}
                aria-hidden="true"
              >
                {selected && (
                  <span
                    className="w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: 'var(--color-primary)' }}
                  />
                )}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
