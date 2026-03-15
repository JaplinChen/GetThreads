/**
 * Self-healing monitoring service — scheduled vault health checks
 * and extractor probing with auto-fix and Telegram alerts.
 */
import type { Telegraf } from 'telegraf';
import type { AppConfig } from '../utils/config.js';
import { healVault } from './vault-healer.js';
import { probeAllExtractors, formatHealthAlert } from './extractor-probe.js';
import { loadMonitorConfig, saveMonitorConfig } from './monitor-store.js';
import type { MonitorConfig } from './health-types.js';
import { logger } from '../core/logger.js';
import { getRegisteredExtractors } from '../extractors/index.js';
import type { Extractor } from '../extractors/types.js';

/** Send Telegram notification to owner */
async function notify(bot: Telegraf, config: AppConfig, message: string): Promise<void> {
  const userId = config.allowedUserIds?.values().next().value;
  if (userId) {
    await bot.telegram.sendMessage(userId, message.slice(0, 4000)).catch(() => {});
  }
}

/** Run vault health check & auto-fix cycle */
async function runVaultHealthCycle(
  bot: Telegraf,
  config: AppConfig,
  monConfig: MonitorConfig,
): Promise<void> {
  const now = Date.now();
  const intervalMs = monConfig.vaultCheckHours * 3_600_000;

  if (monConfig.lastVaultCheckAt) {
    const lastTs = new Date(monConfig.lastVaultCheckAt).getTime();
    if (now - lastTs < intervalMs) return;
  }

  logger.info('monitor', '開始 Vault 自我修復掃描');

  try {
    const result = await healVault(config.vaultPath);

    if (result.autoFixed > 0) {
      await notify(bot, config, [
        '🔧 Vault 自動修復完成',
        '',
        `掃描：${result.totalNotes} 篇`,
        `發現問題：${result.issues.length} 個`,
        `自動修復：${result.autoFixed} 個`,
        '',
        ...result.issues.filter(i => i.fixed).slice(0, 10).map(i => `✅ ${i.file} — ${i.issue}`),
      ].join('\n'));
    }

    monConfig.lastVaultCheckAt = new Date().toISOString();
    await saveMonitorConfig(monConfig);
  } catch (err) {
    logger.warn('monitor', 'Vault 健康檢查失敗', { message: (err as Error).message });
  }
}

/** Run extractor health probe cycle */
async function runExtractorProbeCycle(
  bot: Telegraf,
  config: AppConfig,
  monConfig: MonitorConfig,
): Promise<void> {
  const now = Date.now();
  const intervalMs = monConfig.extractorCheckHours * 3_600_000;

  if (monConfig.lastExtractorCheckAt) {
    const lastTs = new Date(monConfig.lastExtractorCheckAt).getTime();
    if (now - lastTs < intervalMs) return;
  }

  logger.info('monitor', '開始 Extractor 健康檢測');

  try {
    const extractors = ([...getRegisteredExtractors()] as Extractor[]).map((e: Extractor) => ({
      platform: e.platform,
      extract: (url: string) => e.extract(url),
    }));

    const health = await probeAllExtractors(extractors, monConfig.extractorHealth);
    monConfig.extractorHealth = health;

    // Alert on degraded/down extractors
    const alert = formatHealthAlert(health);
    if (alert) {
      await notify(bot, config, alert);
    }

    monConfig.lastExtractorCheckAt = new Date().toISOString();
    await saveMonitorConfig(monConfig);
  } catch (err) {
    logger.warn('monitor', 'Extractor 探測失敗', { message: (err as Error).message });
  }
}

/** Start self-healing monitoring service */
export async function startMonitorService(
  bot: Telegraf,
  config: AppConfig,
): Promise<NodeJS.Timeout[]> {
  const monConfig = await loadMonitorConfig();
  const timers: NodeJS.Timeout[] = [];

  // Vault health cycle: check every 4 hours
  const vaultCheckMs = 4 * 60 * 60 * 1000;
  timers.push(
    setInterval(
      () => { runVaultHealthCycle(bot, config, monConfig).catch(() => {}); },
      vaultCheckMs,
    ),
  );

  // Extractor probe cycle: check every 8 hours
  const extractorCheckMs = 8 * 60 * 60 * 1000;
  timers.push(
    setInterval(
      () => { runExtractorProbeCycle(bot, config, monConfig).catch(() => {}); },
      extractorCheckMs,
    ),
  );

  // Initial vault check after 10 min (non-blocking)
  setTimeout(
    () => { runVaultHealthCycle(bot, config, monConfig).catch(() => {}); },
    10 * 60 * 1000,
  );

  logger.info('monitor', '自我修復監控啟動', {
    vaultCheck: `${monConfig.vaultCheckHours}h`,
    extractorCheck: `${monConfig.extractorCheckHours}h`,
  });

  return timers;
}
