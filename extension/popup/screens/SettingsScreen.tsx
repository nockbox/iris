import { useStore } from '../store';
import IrisLogo from '../assets/iris-logo.svg';
import ThemeIcon from '../assets/theme-icon.svg';
import KeyIcon from '../assets/key-icon.svg';
import ClockIcon from '../assets/clock-icon.svg';
import { CloseIcon } from '../components/icons/CloseIcon';
import { ChevronRightIcon } from '../components/icons/ChevronRightIcon';
import AboutIcon from '../assets/settings-gear-icon.svg';
import { version } from '../../../package-lock.json';

export function SettingsScreen() {
  const { navigate } = useStore();

  function handleClose() {
    navigate('home');
  }
  function handleThemeSettings() {
    navigate('theme-settings');
  }
  function handleKeySettings() {
    navigate('key-settings');
  }
  function handleLockTime() {
    navigate('lock-time');
  }
  function handleV0Migration() {
    navigate('v0-migration');
  }
  function handleAbout() {
    navigate('about');
  }

  const Row = ({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) => (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center justify-between p-2 rounded-lg transition-colors focus:outline-none focus-visible:ring-2"
      onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--color-surface-800)')}
      onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
    >
      <div className="flex items-center gap-2.5 flex-1">
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
          style={{ backgroundColor: 'var(--color-surface-800)' }}
        >
          <img src={icon} alt="" className="w-5 h-5 object-contain" />
        </div>
        <span
          className="text-sm font-medium leading-[18px] tracking-[0.14px]"
          style={{ color: 'var(--color-text-primary)' }}
        >
          {label}
        </span>
      </div>
      <div className="w-4 h-4 p-1 shrink-0">
        <ChevronRightIcon className="w-4 h-4" />
      </div>
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
        <div className="w-8 h-8 flex items-center justify-center shrink-0">
          <img src={IrisLogo} alt="Iris" className="w-6 h-6" />
        </div>
        <h1 className="m-0 text-base font-medium leading-[22px] tracking-[0.16px]">Settings</h1>
        <button
          type="button"
          onClick={handleClose}
          aria-label="Close"
          className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors focus:outline-none focus-visible:ring-2 shrink-0"
          style={{ color: 'var(--color-text-primary)' }}
          onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--color-surface-800)')}
          onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
        >
          <CloseIcon />
        </button>
      </header>

      {/* Content */}
      <div className="flex flex-col justify-between flex-1 h-[536px]">
        {/* Menu */}
        <div className="flex flex-col gap-2 px-3 py-2">
          <Row icon={ThemeIcon} label="Theme settings" onClick={handleThemeSettings} />
          <Row icon={KeyIcon} label="Key settings" onClick={handleKeySettings} />
          <Row icon={ClockIcon} label="Lock time" onClick={handleLockTime} />
          <Row icon={KeyIcon} label="Upgrade v0 → v1" onClick={handleV0Migration} />
          <Row icon={AboutIcon} label="About" onClick={handleAbout} />
        </div>

        {/* Footer */}
        <div className="px-4">
          <div
            className="flex flex-col items-center justify-center gap-2 py-4"
            style={{ borderTop: '1px solid var(--color-divider)' }}
          >
            <p
              className="m-0 text-[12px] leading-4 tracking-[0.24px] text-center"
              style={{ color: 'var(--color-text-muted)' }}
            >
              Version {version}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
