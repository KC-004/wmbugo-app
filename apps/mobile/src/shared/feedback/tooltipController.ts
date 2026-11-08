/** Persistence for "tip already seen"; wired to `prompt_state` in Story 1.14. */
export interface SeenStore {
  hasSeen(id: string): Promise<boolean>;
  markSeen(id: string): Promise<void>;
}

/** In-memory store for tests and until Story 1.14 wires prompt_state. */
export class MemorySeenStore implements SeenStore {
  readonly seen = new Set<string>();
  hasSeen(id: string): Promise<boolean> {
    return Promise.resolve(this.seen.has(id));
  }
  markSeen(id: string): Promise<void> {
    this.seen.add(id);
    return Promise.resolve();
  }
}

/**
 * One-time tips: at most one per session, never while a sheet or dialog is open,
 * never again once marked seen (through the injected store).
 */
export class TooltipController {
  private shownThisSession = false;
  private active: string | null = null;

  constructor(
    private readonly store: SeenStore,
    private readonly sheetOpen: () => boolean,
    private readonly onChange: (id: string | null) => void,
  ) {}

  get current(): string | null {
    return this.active;
  }

  /** Returns true when the tip was shown. */
  async request(id: string): Promise<boolean> {
    if (this.shownThisSession || this.active !== null || this.sheetOpen()) return false;
    if (await this.store.hasSeen(id)) return false;
    if (this.shownThisSession || this.active !== null || this.sheetOpen()) return false; // state may have changed while waiting
    this.shownThisSession = true;
    this.active = id;
    this.onChange(id);
    return true;
  }

  /** "Got it": remember it and hide it. */
  async acknowledge(): Promise<void> {
    const id = this.active;
    if (id === null) return;
    this.active = null;
    this.onChange(null);
    await this.store.markSeen(id);
  }

  /** A sheet opened over the tip: hide it without marking it seen. */
  suspendForSheet(): void {
    if (this.active !== null) {
      this.active = null;
      this.onChange(null);
    }
  }
}
