/**
 * /radar command — manage the content radar.
 * /radar          → show status
 * /radar on|off   → enable/disable
 * /radar add <kw> → add manual query
 * /radar remove <id> → remove query
 * /radar auto     → auto-generate queries from vault
 * /radar run      → manual trigger
 */
import type { Context } from 'telegraf';
import { Markup } from 'telegraf';
import type { AppConfig } from '../utils/config.js';
import { loadRadarConfig, saveRadarConfig, addQuery, removeQuery, autoGenerateQueries } from '../radar/radar-store.js';
import { runRadarCycle } from '../radar/radar-service.js';
import { logger } from '../core/logger.js';

export async function handleRadar(ctx: Context, config: AppConfig): Promise<void> {
  const text = (ctx.message && 'text' in ctx.message ? ctx.message.text : '') ?? '';
  const arg = text.replace(/^\/radar\s*/, '').trim();
  const radarConfig = await loadRadarConfig();

  // /radar (no args) → show status with inline keyboard
  if (!arg) {
    const status = radarConfig.enabled ? '✅ 啟用' : '⏸️ 停用';
    const lastRun = radarConfig.lastRunAt
      ? new Date(radarConfig.lastRunAt).toLocaleString('zh-TW')
      : '從未執行';
    const lines = [
      `🔍 內容雷達 ${status}`,
      '',
      `查詢數：${radarConfig.queries.length}`,
      `間隔：每 ${radarConfig.intervalHours} 小時`,
      `上次執行：${lastRun}`,
    ];

    if (radarConfig.queries.length > 0) {
      lines.push('', '查詢列表：');
      for (const q of radarConfig.queries) {
        const src = q.source === 'auto' ? '🤖' : '✍️';
        lines.push(`${src} [${q.id}] ${q.keywords.join(' ')}`);
      }
    }

    const buttons = [
      [
        Markup.button.callback(radarConfig.enabled ? '⏸️ 停用' : '▶️ 啟用', `radar:toggle`),
        Markup.button.callback('🤖 自動生成', 'radar:auto'),
      ],
      [
        Markup.button.callback('▶️ 立即執行', 'radar:run'),
      ],
    ];

    await ctx.reply(lines.join('\n'), Markup.inlineKeyboard(buttons));
    return;
  }

  // /radar on
  if (arg === 'on') {
    radarConfig.enabled = true;
    await saveRadarConfig(radarConfig);
    await ctx.reply('✅ 內容雷達已啟用（下次 Bot 重啟時生效）');
    return;
  }

  // /radar off
  if (arg === 'off') {
    radarConfig.enabled = false;
    await saveRadarConfig(radarConfig);
    await ctx.reply('⏸️ 內容雷達已停用');
    return;
  }

  // /radar auto
  if (arg === 'auto') {
    await ctx.reply('🤖 正在從 Vault 自動生成查詢...');
    const added = await autoGenerateQueries(config.vaultPath, radarConfig);
    await saveRadarConfig(radarConfig);

    const lines = [`🤖 已生成 ${added.length} 個查詢：`, ''];
    for (const q of added) {
      lines.push(`• [${q.id}] ${q.keywords.join(' ')}`);
    }
    await ctx.reply(lines.join('\n'));
    return;
  }

  // /radar run
  if (arg === 'run') {
    if (radarConfig.queries.length === 0) {
      await ctx.reply('❌ 沒有查詢，請先 /radar auto 或 /radar add <關鍵字>');
      return;
    }
    await ctx.reply(`🔍 開始掃描 ${radarConfig.queries.length} 個查詢...`);
    // Use a minimal bot-like object for notification
    const results = await runRadarCycle(ctx as never, config, radarConfig);
    const saved = results.reduce((s, r) => s + r.saved, 0);
    if (saved === 0) {
      await ctx.reply('📭 本次掃描沒有發現新內容（全部已存在或無結果）');
    }
    return;
  }

  // /radar add <keywords>
  if (arg.startsWith('add ')) {
    const keywords = arg.slice(4).trim().split(/\s+/);
    if (keywords.length === 0) {
      await ctx.reply('用法: /radar add <關鍵字1> <關鍵字2> ...');
      return;
    }
    const query = addQuery(radarConfig, keywords, 'manual');
    await saveRadarConfig(radarConfig);
    await ctx.reply(`✅ 已新增查詢 [${query.id}]: ${keywords.join(' ')}`);
    return;
  }

  // /radar remove <id>
  if (arg.startsWith('remove ')) {
    const id = arg.slice(7).trim();
    if (removeQuery(radarConfig, id)) {
      await saveRadarConfig(radarConfig);
      await ctx.reply(`✅ 已移除查詢 [${id}]`);
    } else {
      await ctx.reply(`❌ 找不到查詢 [${id}]`);
    }
    return;
  }

  await ctx.reply('用法: /radar [on|off|auto|run|add <關鍵字>|remove <id>]');
}

/** Handle InlineKeyboard callbacks for radar */
export async function handleRadarAction(ctx: Context, action: string, config: AppConfig): Promise<void> {
  const radarConfig = await loadRadarConfig();

  if (action === 'toggle') {
    radarConfig.enabled = !radarConfig.enabled;
    await saveRadarConfig(radarConfig);
    await ctx.reply(radarConfig.enabled ? '✅ 雷達已啟用' : '⏸️ 雷達已停用');
    return;
  }

  if (action === 'auto') {
    await ctx.reply('🤖 正在自動生成查詢...');
    const added = await autoGenerateQueries(config.vaultPath, radarConfig);
    await saveRadarConfig(radarConfig);
    const lines = added.map(q => `• ${q.keywords.join(' ')}`);
    await ctx.reply(`已生成 ${added.length} 個查詢\n${lines.join('\n')}`);
    return;
  }

  if (action === 'run') {
    if (radarConfig.queries.length === 0) {
      await ctx.reply('❌ 沒有查詢，請先自動生成');
      return;
    }
    await ctx.reply(`🔍 開始掃描...`);
    const results = await runRadarCycle(ctx as never, config, radarConfig);
    const saved = results.reduce((s, r) => s + r.saved, 0);
    if (saved === 0) {
      await ctx.reply('📭 沒有發現新內容');
    }
    return;
  }

  logger.warn('radar', '未知 action', { action });
}
