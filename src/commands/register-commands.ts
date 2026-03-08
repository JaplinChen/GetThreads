/**
 * Centralised command registration — extracted from bot.ts to stay under 300 lines.
 * All bot.command() calls live here; bot.ts keeps only the core skeleton.
 */
import type { Telegraf } from 'telegraf';
import type { AppConfig } from '../utils/config.js';
import { executeLearn, formatLearnReport } from '../learning/learn-command.js';
import { executeReclassify } from '../learning/reclassify-command.js';
import { executeBatchTranslate } from '../learning/batch-translator.js';
import { handleTimeline } from './timeline-command.js';
import { handleMonitor, handleSearch } from './monitor-command.js';
import { handleAnalyze, handleKnowledge, handleGaps, handleSkills } from './knowledge-command.js';
import { handleRecommend, handleBrief, handleCompare } from './knowledge-query-command.js';
import { camoufoxPool } from '../utils/camoufox-pool.js';

/** Shared error formatter (also used by bot.ts message handler) */
export function formatErrorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/timeout|timed?\s*out|abort/i.test(msg)) return '抓取超時，請稍後重試。';
  if (/login|sign.?in|登入|登录|visitor/i.test(msg)) return '此平台需要登入才能存取，暫不支援。';
  if (/403|forbidden|blocked/i.test(msg)) return '被平台封鎖，請稍後重試。';
  if (/404|not.?found/i.test(msg)) return '找不到此內容，請確認連結是否正確。';
  if (/ENOTFOUND|ECONNREFUSED|network/i.test(msg)) return '網路連線問題，請檢查網路後重試。';
  return `處理失敗：${msg.slice(0, 100)}`;
}

export function registerCommands(
  bot: Telegraf,
  config: AppConfig,
  stats: { urls: number; saved: number; errors: number; recent: string[] },
  startTime: number,
): void {
  const helpText = [
    'GetThreads Bot',
    '',
    '傳送連結即可自動儲存內容與評論：',
    'X / Threads / Reddit / YouTube / GitHub',
    '微博 / B站 / 小紅書 / 抖音 / 任何網頁',
    '',
    '指令：',
    '/search <查詢> — 網頁搜尋',
    '/monitor <關鍵字> — 跨平台搜尋提及',
    '/timeline @用戶 — 抓取用戶最近貼文',
    '/analyze — 深度分析 Vault 知識',
    '/knowledge — 查看知識庫摘要',
    '/recommend <主題> — 推薦相關筆記',
    '/brief <主題> — 主題知識簡報',
    '/compare <A> vs <B> — 實體對比',
    '/gaps — 知識缺口分析',
    '/skills — 高密度主題 Skill 建議',
    '/recent — 本次啟動已儲存的內容',
    '/status — Bot 運行狀態',
    '/learn — 重新掃描 Vault 更新分類',
    '/reclassify — 重新分類所有筆記',
    '/translate — 批次翻譯英文/簡中筆記',
    '/help — 顯示此說明',
  ].join('\n');

  bot.start((ctx) => ctx.reply(helpText));
  bot.command('help', (ctx) => ctx.reply(helpText));

  // --- Learning & Classification ---
  bot.command('learn', (ctx) => {
    ctx.reply('開始掃描 vault，完成後會通知你。').catch(() => {});
    executeLearn(config)
      .then(result => ctx.reply(formatLearnReport(result)).catch(() => {}))
      .catch(err => ctx.reply(formatErrorMessage(err)).catch(() => {}));
  });

  bot.command('reclassify', (ctx) => {
    ctx.reply('開始重新分類筆記，完成後會通知你。').catch(() => {});
    executeReclassify(config)
      .then(result => {
        const lines = [`重新分類完成：${result.total} 篇筆記`, `搬移：${result.moved} 篇`];
        if (result.changes.length > 0) {
          lines.push('', '異動清單：');
          for (const c of result.changes.slice(0, 10)) {
            lines.push(`• ${c.from} → ${c.to}: ${c.file}`);
          }
          if (result.changes.length > 10) lines.push(`...等共 ${result.changes.length} 篇`);
        }
        ctx.reply(lines.join('\n')).catch(() => {});
      })
      .catch(err => ctx.reply(formatErrorMessage(err)).catch(() => {}));
  });

  bot.command('translate', (ctx) => {
    ctx.reply('開始批次翻譯筆記，完成後會通知你。').catch(() => {});
    executeBatchTranslate(config)
      .then(r => {
        const lines = [`批次翻譯完成：掃描 ${r.total} 篇`, `✅${r.translated} ⏭${r.skipped} 🈚${r.noNeed} ❌${r.failed}`];
        for (const d of r.details.slice(0, 15)) lines.push(`• [${d.lang}] ${d.file.slice(0, 40)} ${d.status}`);
        if (r.details.length > 15) lines.push(`...等共 ${r.details.length} 篇`);
        ctx.reply(lines.join('\n')).catch(() => {});
      })
      .catch(err => ctx.reply(formatErrorMessage(err)).catch(() => {}));
  });

  // --- Camoufox-based commands ---
  bot.command('timeline', (ctx) => {
    handleTimeline(ctx, config).catch(err => {
      console.error('[timeline]', err);
      ctx.reply(formatErrorMessage(err)).catch(() => {});
    });
  });

  bot.command('monitor', (ctx) => {
    handleMonitor(ctx, config).catch(err => {
      console.error('[monitor]', err);
      ctx.reply(formatErrorMessage(err)).catch(() => {});
    });
  });

  bot.command(['search', 'google'], (ctx) => {
    handleSearch(ctx, config).catch(err => {
      console.error('[search]', err);
      ctx.reply(formatErrorMessage(err)).catch(() => {});
    });
  });

  // --- Knowledge system ---
  bot.command('analyze', (ctx) => {
    handleAnalyze(ctx, config).catch(err => {
      console.error('[analyze]', err);
      ctx.reply(formatErrorMessage(err)).catch(() => {});
    });
  });

  bot.command('knowledge', (ctx) => {
    handleKnowledge(ctx, config).catch(err => {
      console.error('[knowledge]', err);
      ctx.reply(formatErrorMessage(err)).catch(() => {});
    });
  });

  bot.command('recommend', (ctx) => {
    handleRecommend(ctx, config).catch(err => {
      console.error('[recommend]', err);
      ctx.reply(formatErrorMessage(err)).catch(() => {});
    });
  });

  bot.command('brief', (ctx) => {
    handleBrief(ctx, config).catch(err => {
      console.error('[brief]', err);
      ctx.reply(formatErrorMessage(err)).catch(() => {});
    });
  });

  bot.command('compare', (ctx) => {
    handleCompare(ctx, config).catch(err => {
      console.error('[compare]', err);
      ctx.reply(formatErrorMessage(err)).catch(() => {});
    });
  });

  bot.command('gaps', (ctx) => {
    handleGaps(ctx, config).catch(err => {
      console.error('[gaps]', err);
      ctx.reply(formatErrorMessage(err)).catch(() => {});
    });
  });

  bot.command('skills', (ctx) => {
    handleSkills(ctx, config).catch(err => {
      console.error('[skills]', err);
      ctx.reply(formatErrorMessage(err)).catch(() => {});
    });
  });

  // --- InlineKeyboard callback handlers ---
  bot.action(/^(recommend|brief):(.+)$/, (ctx) => {
    const [, cmd, topic] = ctx.match!;
    ctx.answerCbQuery().catch(() => {});
    (ctx as any).message = { text: `/${cmd} ${topic}` };
    const handler = cmd === 'recommend' ? handleRecommend : handleBrief;
    handler(ctx as any, config).catch(err => {
      console.error(`[${cmd}]`, err);
      ctx.reply(formatErrorMessage(err)).catch(() => {});
    });
  });

  bot.action(/^compare:(.+)$/, (ctx) => {
    const arg = ctx.match![1];
    ctx.answerCbQuery().catch(() => {});
    (ctx as any).message = { text: `/compare ${arg}` };
    handleCompare(ctx as any, config).catch(err => {
      console.error('[compare]', err);
      ctx.reply(formatErrorMessage(err)).catch(() => {});
    });
  });

  // --- Info commands ---
  bot.command('status', async (ctx) => {
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    const h = Math.floor(uptime / 3600);
    const m = Math.floor((uptime % 3600) / 60);
    const pool = camoufoxPool.getStats();
    const mem = process.memoryUsage();
    await ctx.reply(
      [
        'GetThreads Bot 狀態',
        '',
        `運行時間：${h}h ${m}m`,
        `記憶體：${Math.round(mem.rss / 1024 / 1024)} MB`,
        `Camoufox：${pool.inUse} 使用中 / ${pool.total} 總數`,
        '',
        `本次統計：處理 ${stats.urls} 個連結，儲存 ${stats.saved} 篇，失敗 ${stats.errors} 次`,
      ].join('\n'),
    );
  });

  bot.command('recent', async (ctx) => {
    if (stats.recent.length === 0) {
      await ctx.reply('本次啟動尚未儲存任何內容。');
      return;
    }
    const lines = [`本次已儲存 ${stats.saved} 篇：`, ''];
    for (const item of stats.recent.slice(-10).reverse()) {
      lines.push(`• ${item}`);
    }
    await ctx.reply(lines.join('\n'));
  });

  // --- Register command menu ---
  bot.telegram.setMyCommands([
    { command: 'start', description: '顯示 Bot 說明' },
    { command: 'search', description: '網頁搜尋' },
    { command: 'monitor', description: '跨平台搜尋提及' },
    { command: 'timeline', description: '抓取用戶最近貼文' },
    { command: 'analyze', description: '深度分析 Vault 知識' },
    { command: 'knowledge', description: '查看知識庫摘要' },
    { command: 'recommend', description: '推薦相關筆記' },
    { command: 'brief', description: '主題知識簡報' },
    { command: 'compare', description: '實體對比' },
    { command: 'gaps', description: '知識缺口分析' },
    { command: 'skills', description: '高密度主題 Skill 建議' },
    { command: 'recent', description: '本次已儲存的內容' },
    { command: 'status', description: 'Bot 運行狀態' },
    { command: 'learn', description: '重新掃描 Vault 更新分類' },
    { command: 'reclassify', description: '重新分類所有筆記' },
    { command: 'translate', description: '批次翻譯英文/簡中筆記' },
    { command: 'help', description: '顯示說明' },
  ]).catch((err) => console.warn('[bot] setMyCommands failed:', err));
}
