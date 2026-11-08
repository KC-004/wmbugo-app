/**
 * When glass gives way to the solid fallback (UX-DR4 and docs/decisions/S8-reference-devices.md).
 * Pure so every trigger is unit-tested; the platform adapter supplies the facts.
 */
export interface DeviceCapabilities {
  /** Android API level. */
  readonly apiLevel: number;
  /** ActivityManager totalMem in MB; null when unknown. */
  readonly totalRamMb: number | null;
  readonly batterySaver: boolean;
  /** Settings.Global ANIMATOR_DURATION_SCALE (0 = animations off). */
  readonly animatorScale: number;
  /** The in-app "reduce transparency" setting (Story 1.16). */
  readonly reduceTransparency: boolean;
}

export type GlassFallbackReason =
  | 'api-level'
  | 'low-memory'
  | 'battery-saver'
  | 'animator-scale-zero'
  | 'reduce-transparency'
  | 'over-imagery';

/** Glass needs API 31+ (RenderEffect blur). */
export const GLASS_MIN_API = 31;
/**
 * Reported total RAM below this uses the fallback. S8 says "4 GB": a phone sold
 * as 4 GB reports about 3.7-3.9 GB, so the check is on reported memory, 3500 MB,
 * which keeps marketed-4 GB phones on glass and sends 3 GB phones to the fallback.
 */
export const GLASS_MIN_RAM_MB = 3500;

export const UNKNOWN_CAPABILITIES: DeviceCapabilities = {
  apiLevel: 0,
  totalRamMb: null,
  batterySaver: false,
  animatorScale: 1,
  reduceTransparency: false,
};

export function glassFallbackReasons(caps: DeviceCapabilities, opts: { overImagery?: boolean } = {}): GlassFallbackReason[] {
  const reasons: GlassFallbackReason[] = [];
  if (caps.apiLevel < GLASS_MIN_API) reasons.push('api-level');
  if (caps.totalRamMb !== null && caps.totalRamMb < GLASS_MIN_RAM_MB) reasons.push('low-memory');
  if (caps.batterySaver) reasons.push('battery-saver');
  if (caps.animatorScale === 0) reasons.push('animator-scale-zero');
  if (caps.reduceTransparency) reasons.push('reduce-transparency');
  if (opts.overImagery) reasons.push('over-imagery');
  return reasons;
}


/**
 * Backdrop blur is not wired yet (the library choice is deferred, see deferred-work.md). Without blur a
 * translucent surface lets whatever is behind it show through the text, so until blur exists glass is drawn
 * with the opaque `glass-fallback` colour (same layout, tint and border). Set to true when blur lands.
 */
export const BLUR_AVAILABLE = false;
