/**
 * Onboarding Start Screen - Create new or import wallet
 */

import { useStore } from "../../store";
import { AnimatedLogo } from "../../components/AnimatedLogo";
import vectorLeft from "../../assets/vector-left.svg";
import vectorRight from "../../assets/vector-right.svg";
import vectorTopRight from "../../assets/vector-top-right.svg";
import vectorTopRightRotated from "../../assets/vector-top-right-rotated.svg";
import vectorBottomLeft from "../../assets/vector-bottom-left.svg";

export function StartScreen() {
  const { navigate } = useStore();

  return (
    <div className="relative w-[357px] h-[600px] bg-[var(--color-bg)] overflow-hidden">
      {/* Decorative vector elements */}
      <img
        src={vectorLeft}
        alt=""
        className="absolute left-[-11px] top-[199px] w-[89px] h-[70px]"
        aria-hidden="true"
      />
      <img
        src={vectorRight}
        alt=""
        className="absolute left-[305px] top-[311px] w-[52px] h-[83px]"
        aria-hidden="true"
      />
      <img
        src={vectorTopRight}
        alt=""
        className="absolute left-[296px] top-[122px] w-[80px] h-[45px]"
        aria-hidden="true"
      />
      <div
        className="absolute"
        style={{
          left: "calc(50% + 37px)",
          top: "calc(50% - 283px)",
          transform: "rotate(24.652deg)",
          transformOrigin: "center",
        }}
        aria-hidden="true"
      >
        <img
          src={vectorTopRightRotated}
          alt=""
          className="w-[63px] h-[67px]"
        />
      </div>
      <img
        src={vectorBottomLeft}
        alt=""
        className="absolute left-[-23px] top-[362px] w-[64px] h-[64px]"
        aria-hidden="true"
      />

      {/* Main content */}
      <div className="flex flex-col items-center justify-between h-[600px] px-4 pt-[104px] pb-3">
        {/* Top section: Logo and text */}
        <div className="flex flex-col items-center gap-8 w-full">
          {/* Logo */}
          <div className="w-[104px] h-[104px] flex items-center justify-center">
            <AnimatedLogo />
          </div>

          {/* Text content */}
          <div className="flex flex-col gap-2 items-center text-center w-full">
            <h1
              className="font-serif font-medium text-[var(--color-text-primary)]"
              style={{
                fontSize: "var(--font-size-xl)",
                lineHeight: "var(--line-height-relaxed)",
                letterSpacing: "-0.02em",
              }}
            >
              Welcome to Iris
            </h1>
            <p
              className="font-sans text-[var(--color-text-muted)]"
              style={{
                fontSize: "var(--font-size-sm)",
                lineHeight: "var(--line-height-snug)",
                letterSpacing: "0.02em",
              }}
            >
              Your safe wallet for Nockchain
            </p>
          </div>
        </div>

        {/* Bottom section: Buttons */}
        <div className="flex flex-col gap-4 w-full">
          <button
            onClick={() => navigate("onboarding-create")}
            className="h-12 px-5 py-[15px] bg-[var(--color-primary)] rounded-lg flex items-center justify-center transition-opacity hover:opacity-90"
            style={{
              fontFamily: "var(--font-sans)",
              fontSize: "var(--font-size-base)",
              fontWeight: 500,
              lineHeight: "var(--line-height-snug)",
              letterSpacing: "0.01em",
              color: "#000000",
            }}
          >
            Create new wallet
          </button>

          <button
            onClick={() => navigate("onboarding-import")}
            className="h-12 px-5 py-[15px] bg-[var(--color-text-primary)] rounded-lg flex items-center justify-center transition-opacity hover:opacity-90"
            style={{
              fontFamily: "var(--font-sans)",
              fontSize: "var(--font-size-base)",
              fontWeight: 500,
              lineHeight: "var(--line-height-snug)",
              letterSpacing: "0.01em",
              color: "var(--color-bg)",
            }}
          >
            I have a wallet
          </button>
        </div>
      </div>
    </div>
  );
}
