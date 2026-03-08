import { Telegraf } from 'telegraf';
import { logger } from './core/logger.js';
import { writeFileSync, readFileSync, existsSync, unlinkSync } from 'fs';

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
    } catch {
      /* ignore */
    }
  }

  private isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch (err) {
      return (err as NodeJS.ErrnoException).code === 'EPERM';
    }
  }

  private clearStalePidIfDead(): void {
    if (!existsSync(PID_FILE)) return;

    try {
      const pidText = readFileSync(PID_FILE, 'utf8').trim();
      if (!/^\d+$/.test(pidText)) {
        logger.warn('guardian', 'invalid PID format in lockfile; clearing');
        this.clearPid();
        return;
      }

      const pid = Number(pidText);
      if (pid === process.pid) return;

      if (!this.isProcessAlive(pid)) {
        logger.info('guardian', 'removing stale lockfile', { pid });
        this.clearPid();
        return;
      }

      logger.warn('guardian', 'existing process detected; not force-killing', { pid });
    } catch {
      this.clearPid();
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
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
        logger.error('guardian', `409 conflict retry ${this.retries}/${MAX_RETRIES}`, { delaySeconds: delay / 1000 });
        await this.sleep(delay);
        this.attempt();
      } else if (this.retries >= MAX_RETRIES) {
        logger.error('guardian', 'max retries exceeded; run /stopbot then /startbot');
        this.clearPid();
        process.exit(1);
      } else {
        logger.error('guardian', 'fatal error', err);
        this.clearPid();
        process.exit(1);
      }
    });
  }

  launch(): void {
    this.clearStalePidIfDead();
    this.writePid();

    process.once('SIGINT', () => {
      this.clearPid();
      this.bot.stop('SIGINT');
    });
    process.once('SIGTERM', () => {
      this.clearPid();
      this.bot.stop('SIGTERM');
    });

    this.attempt();
    logger.info('guardian', 'bot launching (auto-retry on 409, max 5x)');
  }
}
