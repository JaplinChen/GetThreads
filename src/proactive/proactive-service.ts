/**
 * Proactive intelligence service — scheduled digest push & trend alerts.
 * Transforms GetThreads from passive collector to active knowledge assistant.
 */
import type { Telegraf } from 'telegraf';
import type { AppConfig } from '../utils/config.js';
import type { ProactiveConfig, ProactiveDigest } from './proactive-types.js';
import { DEFAULT_PROACTIVE_CONFIG } from './proactive-types.js';
import { analyzeVaultTrends } from './trend-detector.js';
import { loadProactiveConfig, saveProactiveConfig } from './proactive-store.js';
import { logger } from '../core/logger.js';
import { runLocalLlmPrompt } from '../utils/local-llm.js';

/** Build formatted digest message for Telegram */
function formatDigestMessage(digest: ProactiveDigest): string {
  const lines: string[] = ['📊 每日知識摘要', ''];
  lines.push(`📅 ${digest.period} | 共 ${digest.totalNotes} 篇新筆記`);
  lines.push('');

  // Category breakdown
  if (digest.categoryBreakdown.length > 0) {
    lines.push('【分類概覽】');
    for (const { category, count } of digest.categoryBreakdown.slice(0, 8)) {
      lines.push(`  • ${category}：${count} 篇`);
    }
    lines.push('');
  }

  // Trends
  if (digest.trends.length > 0) {
    lines.push('🔥 【趨勢關鍵字】');
    for (const t of digest.trends.slice(0, 5)) {
      const growth = t.previousCount === 0
        ? '（新出現）'
        : `（+${t.growthRate}%）`;
      lines.push(`  • ${t.keyword}：近期 ${t.recentCount} 次 ${growth}`);
    }
    lines.push('');
  }

  // Category gaps
  if (digest.gaps.length > 0) {
    lines.push('⚠️ 【久未更新分類】');
    for (const g of digest.gaps.slice(0, 5)) {
      lines.push(`  • ${g.category}：已 ${g.daysSinceLastNote} 天未有新內容`);
    }
    lines.push('');
  }

  // AI summary
  if (digest.summary) {
    lines.push('💡 【AI 洞察】');
    lines.push(digest.summary);
  }

  return lines.join('\n');
}

/** Generate AI insight summary for digest (optional, best-effort) */
async function generateDigestInsight(digest: ProactiveDigest): Promise<string | undefined> {
  if (digest.totalNotes < 5) return undefined;

  const catList = digest.categoryBreakdown
    .slice(0, 5)
    .map(c => `${c.category}(${c.count}篇)`)
    .join('、');

  const trendList = digest.trends
    .slice(0, 5)
    .map(t => t.keyword)
    .join('、');

  const prompt = [
    '你是知識管理助手。根據以下用戶近期收集的筆記統計，寫一段 100 字以內的洞察。',
    '語氣中性專業，使用繁體中文。',
    `分類分佈：${catList}`,
    trendList ? `趨勢關鍵字：${trendList}` : '',
    '重點：1. 用戶近期關注焦點 2. 可能的知識探索方向建議',
  ].filter(Boolean).join('\n');

  try {
    const result = await runLocalLlmPrompt(prompt, { timeoutMs: 60_000, model: 'flash' });
    return result ?? undefined;
  } catch {
    return undefined;
  }
}

/** Run proactive digest cycle */
async function runDigestCycle(
  bot: Telegraf,
  config: AppConfig,
  pConfig: ProactiveConfig,
): Promise<void> {
  const now = Date.now();
  const intervalMs = pConfig.digestIntervalHours * 3_600_000;

  // Check if enough time has passed
  if (pConfig.lastDigestAt) {
    const lastTs = new Date(pConfig.lastDigestAt).getTime();
    if (now - lastTs < intervalMs) return;
  }

  logger.info('proactive', '開始生成主動摘要');

  try {
    const { notes, trends, gaps } = await analyzeVaultTrends(config.vaultPath);

    // Count recent notes (last digestIntervalHours)
    const recentCutoff = now - intervalMs;
    const recentNotes = notes.filter(n => new Date(n.date).getTime() >= recentCutoff);

    if (recentNotes.length < pConfig.minNotesForDigest) {
      logger.info('proactive', '近期筆記不足，跳過摘要', { count: recentNotes.length });
      pConfig.lastDigestAt = new Date().toISOString();
      await saveProactiveConfig(pConfig);
      return;
    }

    // Build category breakdown from recent notes
    const catMap = new Map<string, number>();
    for (const n of recentNotes) {
      catMap.set(n.category, (catMap.get(n.category) ?? 0) + 1);
    }
    const categoryBreakdown = [...catMap.entries()]
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count);

    const hours = pConfig.digestIntervalHours;
    const period = hours >= 24 ? `近 ${Math.round(hours / 24)} 天` : `近 ${hours} 小時`;

    const digest: ProactiveDigest = {
      period,
      totalNotes: recentNotes.length,
      categoryBreakdown,
      trends,
      gaps,
    };

    // Best-effort AI insight
    digest.summary = await generateDigestInsight(digest);

    const message = formatDigestMessage(digest);
    const userId = config.allowedUserIds?.values().next().value;
    if (userId) {
      await bot.telegram.sendMessage(userId, message.slice(0, 4000));
    }

    pConfig.lastDigestAt = new Date().toISOString();
    await saveProactiveConfig(pConfig);
    logger.info('proactive', '主動摘要完成', { notes: recentNotes.length, trends: trends.length });
  } catch (err) {
    logger.warn('proactive', '主動摘要失敗', { message: (err as Error).message });
  }
}

/** Run trend alert cycle (more frequent than digest) */
async function runTrendCycle(
  bot: Telegraf,
  config: AppConfig,
  pConfig: ProactiveConfig,
): Promise<void> {
  const now = Date.now();
  const intervalMs = pConfig.trendIntervalHours * 3_600_000;

  if (pConfig.lastTrendAt) {
    const lastTs = new Date(pConfig.lastTrendAt).getTime();
    if (now - lastTs < intervalMs) return;
  }

  try {
    const { trends } = await analyzeVaultTrends(config.vaultPath);

    // Only alert for significant new trends (3+ recent mentions, new keyword)
    const significantTrends = trends.filter(t => t.recentCount >= 3 && t.previousCount === 0);

    if (significantTrends.length > 0) {
      const userId = config.allowedUserIds?.values().next().value;
      if (userId) {
        const lines = ['🔔 趨勢提醒', ''];
        for (const t of significantTrends.slice(0, 3)) {
          lines.push(`• 「${t.keyword}」近期出現 ${t.recentCount} 次（之前未出現）`);
        }
        await bot.telegram.sendMessage(userId, lines.join('\n')).catch(() => {});
      }
    }

    pConfig.lastTrendAt = new Date().toISOString();
    await saveProactiveConfig(pConfig);
  } catch (err) {
    logger.warn('proactive', '趨勢偵測失敗', { message: (err as Error).message });
  }
}

/** Start proactive intelligence service */
export async function startProactiveService(
  bot: Telegraf,
  config: AppConfig,
): Promise<NodeJS.Timeout[]> {
  const pConfig = await loadProactiveConfig();
  if (!pConfig.enabled) {
    logger.info('proactive', '主動推理已停用');
    return [];
  }

  const timers: NodeJS.Timeout[] = [];

  // Digest cycle: check every hour if it's time
  const digestCheckMs = 60 * 60 * 1000; // 1 hour
  timers.push(
    setInterval(() => { runDigestCycle(bot, config, pConfig).catch(() => {}); }, digestCheckMs),
  );

  // Trend cycle: check every 2 hours
  const trendCheckMs = 2 * 60 * 60 * 1000;
  timers.push(
    setInterval(() => { runTrendCycle(bot, config, pConfig).catch(() => {}); }, trendCheckMs),
  );

  // Run initial digest check after 5 min delay (let other services init first)
  setTimeout(() => { runDigestCycle(bot, config, pConfig).catch(() => {}); }, 5 * 60 * 1000);

  logger.info('proactive', '主動推理服務啟動', {
    digestInterval: `${pConfig.digestIntervalHours}h`,
    trendInterval: `${pConfig.trendIntervalHours}h`,
  });

  return timers;
}
