/**
 * /suggest command — trigger related-note link suggestions.
 * /suggest        → full vault scan + write + index
 * /suggest <URL>  → single note
 */
import type { Context } from 'telegraf';
import type { AppConfig } from '../utils/config.js';
import { suggestAllLinks, loadNoteIndex, suggestLinks } from '../vault/link-suggester.js';
import { writeSuggestionsToNote, writeIndexNote } from '../vault/link-writer.js';
import { logger } from '../core/logger.js';

export async function handleSuggest(ctx: Context, config: AppConfig): Promise<void> {
  const text = (ctx.message && 'text' in ctx.message ? ctx.message.text : '') ?? '';
  const arg = text.replace(/^\/suggest\s*/, '').trim();

  if (arg) {
    // Single note mode
    const noteIndex = await loadNoteIndex(config.vaultPath);
    const note = noteIndex.find(n => n.url.includes(arg) || n.filePath.includes(arg));
    if (!note) {
      await ctx.reply(`找不到筆記: ${arg}`);
      return;
    }

    const suggestions = await suggestLinks(note.url, noteIndex);
    if (suggestions.length === 0) {
      await ctx.reply(`📝 ${note.title}\n\n沒有找到相關筆記`);
      return;
    }

    const lines = [`📝 ${note.title}`, '', `找到 ${suggestions.length} 篇相關筆記：`];
    for (const s of suggestions) {
      lines.push(`• ${s.title}（${s.sharedKeywords.slice(0, 3).join(', ')}）`);
    }

    await writeSuggestionsToNote(note.filePath, suggestions);
    lines.push('', '✅ 已寫入筆記底部');
    await ctx.reply(lines.join('\n'));
    return;
  }

  // Full scan
  await ctx.reply('🔗 開始掃描所有筆記的相關連結...');

  const allSuggestions = await suggestAllLinks(config.vaultPath);
  let written = 0;
  for (const [filePath, suggestions] of allSuggestions) {
    if (await writeSuggestionsToNote(filePath, suggestions)) written++;
  }

  const indexPath = await writeIndexNote(config.vaultPath, allSuggestions);

  const msg = [
    '🔗 相關筆記推薦完成',
    '',
    `📊 ${allSuggestions.size} 篇筆記有推薦`,
    `✅ ${written} 篇已寫入連結`,
    `📋 索引: ${indexPath.split('GetThreads')[1] ?? indexPath}`,
  ];

  logger.info('suggest', '完成', { total: allSuggestions.size, written });
  await ctx.reply(msg.join('\n'));
}
