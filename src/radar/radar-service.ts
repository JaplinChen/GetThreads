/**
 * Content radar background service — periodically searches for new content
 * based on vault keywords and auto-saves to Obsidian vault.
 * Pattern: mirrors subscription-checker.ts
 */
import type { Telegraf } from 'telegraf';
import type { AppConfig } from '../utils/config.js';
import type { RadarConfig, RadarResult } from './radar-types.js';
import { saveRadarConfig } from './radar-store.js';
import { webSearch } from '../utils/search-service.js';
import { findExtractor } from '../utils/url-parser.js';
import { classifyContent } from '../classifier.js';
import { saveToVault, isDuplicateUrl } from '../saver.js';
import { logger } from '../core/logger.js';

/** Run a single radar query: search → extract → classify → save */
async function runQuery(
  query: RadarConfig['queries'][0],
  config: AppConfig,
  maxResults: number,
): Promise<RadarResult> {
  const result: RadarResult = { query, saved: 0, skipped: 0, errors: 0 };

  try {
    const searchResults = await webSearch(query.keywords.join(' '), maxResults);
    if (searchResults.length === 0) return result;

    for (const sr of searchResults) {
      try {
        // Dedup check
        const existing = await isDuplicateUrl(sr.url, config.vaultPath);
        if (existing) { result.skipped++; continue; }

        // Find extractor
        const extractor = findExtractor(sr.url);
        if (!extractor) { result.skipped++; continue; }

        // Extract content
        const content = await extractor.extract(sr.url);

        // Classify
        content.category = classifyContent(content.title, content.text);

        // Save to vault
        const saveResult = await saveToVault(content, config.vaultPath);
        if (saveResult.duplicate) {
          result.skipped++;
        } else {
          result.saved++;
        }
      } catch (err) {
        result.errors++;
        logger.warn('radar', '單一 URL 失敗', {
          url: sr.url,
          err: (err as Error).message,
        });
      }
    }

    query.lastHitCount = result.saved;
  } catch (err) {
    logger.warn('radar', '查詢失敗', {
      keywords: query.keywords.join(' '),
      err: (err as Error).message,
    });
  }

  return result;
}

/** Run a full radar cycle across all queries */
export async function runRadarCycle(
  bot: Telegraf, config: AppConfig, radarConfig: RadarConfig,
): Promise<RadarResult[]> {
  if (radarConfig.queries.length === 0) return [];

  logger.info('radar', '開始掃描', { queries: radarConfig.queries.length });
  const results: RadarResult[] = [];
  let totalSaved = 0;

  for (const query of radarConfig.queries) {
    if (totalSaved >= radarConfig.maxTotalPerCycle) break;

    const remaining = radarConfig.maxTotalPerCycle - totalSaved;
    const maxResults = Math.min(radarConfig.maxResultsPerQuery, remaining);
    const result = await runQuery(query, config, maxResults);
    results.push(result);
    totalSaved += result.saved;
  }

  radarConfig.lastRunAt = new Date().toISOString();
  await saveRadarConfig(radarConfig);

  // Notify user if any new content found
  if (totalSaved > 0) {
    const userId = config.allowedUserIds?.values().next().value;
    if (userId) {
      const lines = [`🔍 內容雷達：發現 ${totalSaved} 篇新內容`, ''];
      for (const r of results) {
        if (r.saved > 0) {
          lines.push(`• ${r.saved} 篇 — 搜尋「${r.query.keywords.join(' ')}」`);
        }
      }
      const totalSkipped = results.reduce((s, r) => s + r.skipped, 0);
      if (totalSkipped > 0) lines.push(`\n（${totalSkipped} 篇已存在，已跳過）`);

      await bot.telegram.sendMessage(userId, lines.join('\n')).catch(() => {});
    }
  }

  const totalErrors = results.reduce((s, r) => s + r.errors, 0);
  logger.info('radar', '掃描完成', { totalSaved, totalErrors });
  return results;
}

/** Start the background radar checker */
export function startRadarChecker(
  bot: Telegraf, config: AppConfig, radarConfig: RadarConfig,
): NodeJS.Timeout {
  const intervalMs = (radarConfig.intervalHours || 6) * 60 * 60 * 1000;

  logger.info('radar', '啟動內容雷達', {
    interval: `${radarConfig.intervalHours}h`,
    queries: radarConfig.queries.length,
  });

  return setInterval(
    () => { runRadarCycle(bot, config, radarConfig).catch(() => {}); },
    intervalMs,
  );
}
