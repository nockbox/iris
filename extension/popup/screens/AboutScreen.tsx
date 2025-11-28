import { useStore } from '../store';
import IrisLogo96 from '../assets/iris-logo-96.svg';
import { ChevronLeftIcon } from '../components/icons/ChevronLeftIcon';
import { version } from '../../../package-lock.json';

/**
 * AboutScreen
 */
export function AboutScreen() {
  const { navigate } = useStore();

  function handleBack() {
    navigate('settings');
  }

  function handlePrivacyPolicy() {
    window.open('https://iriswallet.io/privacy-policy', '_blank');
  }

  function handleTermsOfUse() {
    window.open('https://iriswallet.io/terms-of-use', '_blank');
  }

  function handleVisitWebsite() {
    window.open('https://iriswallet.io', '_blank');
  }

  function handleFAQ() {
    window.open('https://iriswallet.io/faq', '_blank');
  }

  return (
    <div
      className="w-[357px] h-[600px] flex flex-col overflow-y-auto font-sans"
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
          className="w-8 h-8 p-2 flex items-center justify-center rounded-lg flex-shrink-0 cursor-pointer transition-colors focus:outline-none focus-visible:ring-2"
          style={{ color: 'var(--color-text-primary)' }}
          onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--color-surface-800)')}
          onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
        >
          <ChevronLeftIcon className="w-5 h-5" />
        </button>

        <h1 className="m-0 text-base font-medium leading-[22px] tracking-[0.16px]">About</h1>

        <div className="w-8 h-8 flex-shrink-0" />
      </header>

      {/* Content */}
      <div className="flex flex-col items-center gap-6 px-4 py-2 h-[536px]">
        <div className="w-24 h-24 flex items-center justify-center flex-shrink-0">
          <img src={IrisLogo96} alt="Iris" className="w-24 h-24" />
        </div>

        <div className="w-full flex flex-col items-center justify-center gap-1">
          <p className="m-0 text-base font-medium leading-[22px] tracking-[0.16px] text-center">
            Iris Version {version}
          </p>
        </div>

        <div className="w-full h-px" style={{ backgroundColor: 'var(--color-divider)' }} />

        <div className="w-full flex flex-col gap-3">
          <h2
            className="m-0 text-sm font-medium leading-[18px] tracking-[0.14px]"
            style={{ color: 'var(--color-text-muted)' }}
          >
            Links
          </h2>

          <div className="w-full flex flex-col gap-4">
            <button
              type="button"
              onClick={handlePrivacyPolicy}
              className="text-left bg-transparent p-0 text-base font-medium leading-[22px] tracking-[0.16px] underline underline-offset-2 transition-opacity hover:opacity-70 focus:outline-none focus-visible:ring-2"
            >
              Privacy policy
            </button>

            <button
              type="button"
              onClick={handleTermsOfUse}
              className="text-left bg-transparent p-0 text-base font-medium leading-[22px] tracking-[0.16px] underline underline-offset-2 transition-opacity hover:opacity-70 focus:outline-none focus-visible:ring-2"
            >
              Terms of use
            </button>

            <button
              type="button"
              onClick={handleFAQ}
              className="text-left bg-transparent p-0 text-base font-medium leading-[22px] tracking-[0.16px] underline underline-offset-2 transition-opacity hover:opacity-70 focus:outline-none focus-visible:ring-2"
            >
              FAQ
            </button>

            <button
              type="button"
              onClick={handleVisitWebsite}
              className="text-left bg-transparent p-0 text-base font-medium leading-[22px] tracking-[0.16px] underline underline-offset-2 transition-opacity hover:opacity-70 focus:outline-none focus-visible:ring-2"
            >
              Visit our website
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
