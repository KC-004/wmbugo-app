import LottieView from 'lottie-react-native';
import { CoinMark } from './CoinMark';
import coinFlip from './coin-flip.json';

/**
 * Coin-flip animation (PLACEHOLDER Lottie until the final asset, GATE-12). With reduced motion
 * (or when not playing) the still pie face is shown instead.
 */
export function CoinFlip({ size = 96, playing = true, reducedMotion = false }: { size?: number; playing?: boolean; reducedMotion?: boolean }) {
  if (reducedMotion || !playing) return <CoinMark size={size} />;
  return <LottieView source={coinFlip} autoPlay loop={false} style={{ width: size, height: size }} />;
}
