export interface ToastRequest {
  readonly message: string;
  /** Reversible actions always offer Undo. */
  readonly undo?: { readonly label: string; readonly onUndo: () => void };
  /** A question with answers (Keep both / Merge): each answer closes the toast and runs. */
  readonly choices?: readonly { readonly label: string; readonly onChoose: () => void }[];
}

export interface ToastState {
  readonly id: number;
  readonly message: string;
  readonly undo?: ToastRequest['undo'];
  readonly choices?: ToastRequest['choices'];
}

export interface ToastDeps {
  /** System-recommended timeout (AccessibilityInfo.getRecommendedTimeoutMillis). */
  recommendedMs(originalMs: number): Promise<number>;
  /** TalkBack or another screen reader is running: the toast then stays until dismissed or acted on. */
  screenReaderOn(): boolean;
  announce(text: string): void;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  now(): number;
  onChange(state: ToastState | null): void;
}

/** Never shorter than this, whatever the system recommends. */
export const MIN_TOAST_MS = 10_000;

/**
 * One toast at a time. Showing a new one replaces the current. It stays at least 10 s
 * (longer when the system asks for more), pauses while touched or focused, persists
 * under a screen reader, and announces politely ("Saved. Undo available").
 */
export class ToastController {
  private current: ToastState | null = null;
  private nextId = 1;
  private timer: unknown = null;
  private remaining = 0;
  private startedAt = 0;
  private paused = false;

  constructor(private readonly deps: ToastDeps) {}

  get state(): ToastState | null {
    return this.current;
  }

  async show(req: ToastRequest): Promise<void> {
    this.clear();
    const id = this.nextId++;
    this.current = { id, message: req.message, ...(req.undo ? { undo: req.undo } : {}), ...(req.choices ? { choices: req.choices } : {}) };
    this.deps.onChange(this.current);
    this.deps.announce(req.choices ? `${req.message}. ${req.choices.map((c) => c.label).join(' or ')}` : req.undo ? `${req.message}. Undo available` : req.message);

    const recommended = await this.deps.recommendedMs(MIN_TOAST_MS).catch(() => MIN_TOAST_MS);
    if (this.current?.id !== id) return; // replaced or dismissed while waiting
    this.remaining = Math.max(MIN_TOAST_MS, recommended);
    if (!this.deps.screenReaderOn() && !this.paused) this.arm();
  }

  /** Touch or focus: stop the clock, keeping the time that is left. */
  pause(): void {
    this.paused = true;
    if (this.timer !== null) {
      this.remaining = Math.max(0, this.remaining - (this.deps.now() - this.startedAt));
      this.deps.clearTimer(this.timer);
      this.timer = null;
    }
  }

  resume(): void {
    this.paused = false;
    if (this.current && this.timer === null && this.remaining > 0 && !this.deps.screenReaderOn()) this.arm();
  }

  undo(): void {
    const t = this.current;
    this.dismiss();
    t?.undo?.onUndo();
  }

  choose(index: number): void {
    const c = this.current?.choices?.[index];
    this.dismiss();
    c?.onChoose();
  }

  dismiss(): void {
    this.clear();
    this.current = null;
    this.deps.onChange(null);
  }

  private arm(): void {
    this.startedAt = this.deps.now();
    this.timer = this.deps.setTimer(() => this.dismiss(), this.remaining);
  }

  private clear(): void {
    if (this.timer !== null) this.deps.clearTimer(this.timer);
    this.timer = null;
    this.paused = false;
  }
}
