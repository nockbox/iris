/**
 * Maps wallet icon style ids (see shared/walletStyles.ts) to their SVG assets.
 * Every asset uses the `var(--fill-0, #FFC413)` placeholder so it can be
 * tinted with any account color at render time.
 */

import Style1 from '../assets/wallet-icon-style-1.svg';
import Style2 from '../assets/wallet-icon-style-2.svg';
import Style3 from '../assets/wallet-icon-style-3.svg';
import Style8 from '../assets/wallet-icon-style-8.svg';
import Style14 from '../assets/wallet-icon-style-14.svg';
import GazeLeft from '../assets/wallet-icon-gaze-left.svg';
import GazeRight from '../assets/wallet-icon-gaze-right.svg';
import GazeDown from '../assets/wallet-icon-gaze-down.svg';
import SquircleEye from '../assets/wallet-icon-squircle-eye.svg';
import SealEye from '../assets/wallet-icon-seal-eye.svg';
import QuatrefoilEye from '../assets/wallet-icon-quatrefoil-eye.svg';
import CatEye from '../assets/wallet-icon-cat-eye.svg';
import Ring from '../assets/wallet-icon-ring.svg';
import Target from '../assets/wallet-icon-target.svg';
import Sun from '../assets/wallet-icon-sun.svg';
import PinwheelSun from '../assets/wallet-icon-pinwheel-sun.svg';
import Moon from '../assets/wallet-icon-moon.svg';
import NorthStar from '../assets/wallet-icon-north-star.svg';
import Orbit from '../assets/wallet-icon-orbit.svg';
import Spiral from '../assets/wallet-icon-spiral.svg';
import Fibonacci from '../assets/wallet-icon-fibonacci.svg';
import SealFibonacci from '../assets/wallet-icon-seal-fibonacci.svg';
import Snowflake from '../assets/wallet-icon-snowflake.svg';
import Gem from '../assets/wallet-icon-gem.svg';
import Heart from '../assets/wallet-icon-heart.svg';
import Bolt from '../assets/wallet-icon-bolt.svg';
import Keyhole from '../assets/wallet-icon-keyhole.svg';
import NockN from '../assets/wallet-icon-nock-n.svg';
import NockNRound from '../assets/wallet-icon-nock-n-round.svg';

export const WALLET_ICON_ASSETS: Record<string, string> = {
  'style-1': Style1,
  'style-2': Style2,
  'style-3': Style3,
  'style-8': Style8,
  'style-14': Style14,
  'gaze-left': GazeLeft,
  'gaze-right': GazeRight,
  'gaze-down': GazeDown,
  'squircle-eye': SquircleEye,
  'seal-eye': SealEye,
  'quatrefoil-eye': QuatrefoilEye,
  'cat-eye': CatEye,
  ring: Ring,
  target: Target,
  sun: Sun,
  'pinwheel-sun': PinwheelSun,
  moon: Moon,
  'north-star': NorthStar,
  orbit: Orbit,
  spiral: Spiral,
  fibonacci: Fibonacci,
  'seal-fibonacci': SealFibonacci,
  snowflake: Snowflake,
  gem: Gem,
  heart: Heart,
  bolt: Bolt,
  keyhole: Keyhole,
  'nock-n': NockN,
  'nock-n-round': NockNRound,
};
