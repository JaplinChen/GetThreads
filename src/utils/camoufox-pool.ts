/**
 * Camoufox Browser Pool
 * Singleton lazy pool: max 2 instances, auto-close after 10 min idle.
 * Provides anti-detection Firefox browsers (C++ fingerprint spoofing).
 */
import { Camoufox } from 'camoufox-js';
import type { Browser, Page } from 'playwright-core';

interface PoolEntry {
  browser: Browser;
  inUse: boolean;
}

class CamoufoxPool {
  private entries: PoolEntry[] = [];
  private idleTimer?: NodeJS.Timeout;
  private readonly MAX_SIZE = 2;
  private readonly IDLE_MS = 10 * 60 * 1000; // 10 minutes

  /** Acquire a page from the pool. Call release() when done. */
  async acquire(): Promise<{ page: Page; release: () => Promise<void> }> {
    const entry = await this.getAvailableEntry();
    entry.inUse = true;
    this.resetIdleTimer();

    const page = await entry.browser.newPage();

    return {
      page,
      release: async () => {
        await page.close().catch(() => { /* ignore close errors */ });
        entry.inUse = false;
        this.resetIdleTimer();
      },
    };
  }

  private async getAvailableEntry(): Promise<PoolEntry> {
    // Return idle entry if available
    const idle = this.entries.find(e => !e.inUse);
    if (idle) return idle;

    // Spin up new browser if pool not full
    if (this.entries.length < this.MAX_SIZE) {
      const browser = await Camoufox({ headless: true });
      const entry: PoolEntry = { browser, inUse: false };
      this.entries.push(entry);
      return entry;
    }

    // Wait for an entry to become free (max 30 seconds)
    return this.waitForFree();
  }

  private async waitForFree(timeoutMs = 30_000): Promise<PoolEntry> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const idle = this.entries.find(e => !e.inUse);
      if (idle) return idle;
      await new Promise(r => setTimeout(r, 250));
    }
    throw new Error('CamoufoxPool timeout: all browsers are busy (>30s)');
  }

  private resetIdleTimer(): void {
    clearTimeout(this.idleTimer);
    const allIdle = this.entries.every(e => !e.inUse);
    if (allIdle && this.entries.length > 0) {
      this.idleTimer = setTimeout(() => {
        this.closeAll().catch(() => { /* ignore */ });
      }, this.IDLE_MS);
    }
  }

  /** Close all browsers and clear the pool (called automatically after idle). */
  async closeAll(): Promise<void> {
    clearTimeout(this.idleTimer);
    await Promise.all(this.entries.map(e => e.browser.close().catch(() => {})));
    this.entries = [];
  }
}

/** Singleton pool instance — import and use throughout the app. */
export const camoufoxPool = new CamoufoxPool();
