import { Telegraf } from 'telegraf';
import { writeFileSync, readFileSync, existsSync, unlinkSync } from 'fs';
import { execFileSync } from 'child_process';

const PID_FILE = '.bot.pid';
const MAX_RETRIES = 5;
const BASE_DELAY_MS = 2_000;

export class ProcessGuardian {
  private retries = 0;

  constructor(private bot: Telegraf) {}

  private writePid(): void {
    writeFileSync(PID_FILE, String(process.pid));
  }

  private clearPid(): void {
    try {
      if (existsSync(PID_FILE)) unlinkSync(PID_FILE);
    } catch { /* ignore */ }
  }

  private killExistingByPid(): void {
    if (!existsSync(PID_FILE)) return;
    try {
      const pid = readFileSync(PID_FILE, 'utf8').trim();
      if (!/^\d+$/.test(pid)) {
        console.warn('[Guardian] Invalid PID format in lockfile, clearing');
        this.clearPid();
        return;
      }
      if (pid && pid !== String(process.pid)) {
        execFileSync('taskkill', ['/F', '/PID', pid], { stdio: 'ignore' });
        console.log(`[Guardian] Killed stale process PID=${pid}`);
      }
    } catch { /* already gone */ }
    this.clearPid();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private is409(err: unknown): boolean {
    const msg = err instanceof Error ? err.message : String(err);
    return msg.includes('409') || msg.includes('Conflict');
  }

  private attempt(): void {
    this.bot.launch({ dropPendingUpdates: true }).catch(async (err: unknown) => {
      if (this.is409(err) && this.retries < MAX_RETRIES) {
        this.retries++;
        const delay = Math.min(BASE_DELAY_MS * 2 ** this.retries, 60_000);
        console.error(`[Guardian] 409 Conflict — retry ${this.retries}/${MAX_RETRIES} in ${delay / 1000}s`);
        await this.sleep(delay);
        this.attempt();
      } else if (this.retries >= MAX_RETRIES) {
        console.error('[Guardian] Max retries exceeded. Run /stopbot then /startbot.');
        this.clearPid();
        process.exit(1);
      } else {
        console.error('[Guardian] Fatal error:', err);
        this.clearPid();
        process.exit(1);
      }
    });
  }

  launch(): void {
    this.killExistingByPid();
    this.writePid();

    process.once('SIGINT', () => { this.clearPid(); this.bot.stop('SIGINT'); });
    process.once('SIGTERM', () => { this.clearPid(); this.bot.stop('SIGTERM'); });

    this.attempt();
    console.log('[Guardian] Bot launching... (auto-retry on 409, max 5x)');
  }
}
