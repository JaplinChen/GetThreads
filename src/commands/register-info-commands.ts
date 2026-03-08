import type { Telegraf } from 'telegraf';
import { camoufoxPool } from '../utils/camoufox-pool.js';

export interface CommandStats {
  urls: number;
  saved: number;
  errors: number;
  recent: string[];
}

export function registerInfoCommands(bot: Telegraf, stats: CommandStats, startTime: number): void {
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
}
