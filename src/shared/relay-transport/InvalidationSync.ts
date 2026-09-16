/** Happy InvalidateSync ownership: one read in flight and one dirty successor.
 * Read transport owns retries; this owner coalesces notifications and lifecycle.
 */
export class InvalidationSync {
  private dirty = false;
  private stopped = false;
  private running: Promise<void> | null = null;
  constructor(private readonly read: () => Promise<void>) {}
  invalidate(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    this.dirty = true;
    if (!this.running) {
      this.running = Promise.resolve().then(async () => {
        while (this.dirty && !this.stopped) {
          this.dirty = false;
          await this.read();
        }
      }).finally(() => { this.running = null; });
    }
    return this.running;
  }
  stop(): void { this.stopped = true; this.dirty = false; }
}
