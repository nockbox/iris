import { useStore } from '../store';
import { useTheme } from '../contexts/ThemeContext';
import { ChevronLeftIcon } from '../components/icons/ChevronLeftIcon';

export function ThemeSettingsScreen() {
  const { navigate } = useStore();
  const { theme, setTheme } = useTheme();

  function handleBack() {
    navigate('settings');
  }
  function handleThemeSelect(newTheme: 'light' | 'dark' | 'system') {
    setTheme(newTheme);
  }

  const Option = ({
    label,
    selected,
    onClick,
    disabled = false,
  }: {
    label: string;
    selected?: boolean;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center justify-between p-3 rounded-lg transition-colors text-left w-full focus:outline-none focus-visible:ring-2 ${
        disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'
      }`}
      style={{
        backgroundColor: disabled ? 'transparent' : 'transparent',
      }}
      onMouseEnter={(e) => {
        if (!disabled) {
          e.currentTarget.style.backgroundColor = 'var(--color-surface-800)';
        }
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = 'transparent';
      }}
      role="radio"
      aria-checked={!!selected}
    >
      <span className="text-sm font-medium leading-[18px] tracking-[0.14px] flex-1">{label}</span>
      <span
        className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 transition-all"
        style={{
          border: `1px solid ${selected ? 'var(--color-primary)' : 'var(--color-surface-700)'}`,
          backgroundColor: selected ? 'var(--color-primary)' : 'var(--color-bg)',
        }}
      >
        {selected && <span className="w-3 h-3 rounded-full" style={{ backgroundColor: '#000' }} />}
      </span>
    </button>
  );

  return (
    <div
      className="w-[357px] h-[600px] flex flex-col overflow-y-auto"
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
          className="w-8 h-8 bg-transparent rounded-lg p-2 flex items-center justify-center shrink-0 transition-colors focus:outline-none focus-visible:ring-2"
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--color-surface-800)')}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
        >
          <ChevronLeftIcon className="w-5 h-5" />
        </button>
        <h1 className="m-0 text-base font-medium leading-[22px] tracking-[0.16px]">
          Theme settings
        </h1>
        <div className="w-8 h-8 shrink-0" />
      </header>

      {/* Options */}
      <div className="flex flex-col gap-2 px-3 py-2" role="radiogroup" aria-label="Theme">
        <Option
          label="Light"
          selected={theme === 'light'}
          onClick={() => handleThemeSelect('light')}
        />
        <Option
          label="Dark"
          selected={theme === 'dark'}
          onClick={() => handleThemeSelect('dark')}
        />
        <Option
          label="System"
          selected={theme === 'system'}
          onClick={() => handleThemeSelect('system')}
        />
      </div>
    </div>
  );
}
