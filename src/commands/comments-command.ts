/**
 * /comments command — fetches post content + comments, saves both to Obsidian vault.
 * Automatically extracts the main post AND its comments in one step.
 * Supports X, Threads, Reddit, and Bilibili via their extractComments() methods.
 */
import type { Context } from 'telegraf';
import type { AppConfig } from '../utils/config.js';
import type { ExtractorWithComments } from '../extractors/types.js';
import { findExtractor, extractUrls } from '../utils/url-parser.js';
import { saveToVault } from '../saver.js';
import { classifyContent } from '../classifier.js';

export async function handleComments(ctx: Context, config: AppConfig): Promise<void> {
  const text = 'text' in ctx.message! ? (ctx.message as { text: string }).text : '';
  const parts = text.trim().split(/\s+/);
  const rawUrl = parts[1];
  const limitArg = parseInt(parts[2] ?? '20', 10);
  const limit = isNaN(limitArg) ? 20 : Math.min(limitArg, 50);

  // Also allow URL pasted without space after /comments
  const urls = rawUrl ? [rawUrl] : extractUrls(text).slice(0, 1);
  const url = urls[0];

  if (!url) {
    await ctx.reply('用法：/comments <url> [數量]\n例：/comments https://www.threads.net/@zuck/post/xxx 20');
    return;
  }

  const extractor = findExtractor(url);
  if (!extractor) {
    await ctx.reply(`不支援的連結：${url}`);
    return;
  }

  const withComments = extractor as Partial<ExtractorWithComments>;
  if (typeof withComments.extractComments !== 'function') {
    await ctx.reply(`${extractor.platform} 平台目前不支援評論抓取`);
    return;
  }

  const status = await ctx.reply(`正在抓取 ${extractor.platform} 貼文與評論，請稍候...`);

  try {
    // Parallel: fetch main post content + comments simultaneously
    const [mainResult, commentsResult] = await Promise.allSettled([
      extractor.extract(url),
      withComments.extractComments!(url, limit),
    ]);

    if (mainResult.status === 'rejected') throw mainResult.reason as Error;
    const content = mainResult.value;
    const comments = commentsResult.status === 'fulfilled' ? commentsResult.value : [];

    // Merge comments into content so formatter includes them in the vault note
    content.comments = comments;
    if (comments.length > 0) content.commentCount = comments.length;

    // Classify and save — forceOverwrite ensures comments are saved even if post exists
    content.category = classifyContent(content.title, content.text);
    const saved = await saveToVault(content, config.vaultPath, { forceOverwrite: true });

    const lines = [
      `💬 已儲存：${content.title.slice(0, 50)}`,
      `評論：${comments.length} 則 | 分類：${content.category}`,
      `檔案：${saved.mdPath}`,
    ];

    if (comments.length > 0) {
      lines.push('', '─── 評論預覽 ───');
      for (const c of comments.slice(0, 5)) {
        const likes = c.likes ? ` ❤️${c.likes}` : '';
        lines.push(`**${c.author}**${likes}: ${c.text.slice(0, 100)}`);
      }
      if (comments.length > 5) lines.push(`_...共 ${comments.length} 則，完整內容已存入 Vault_`);
    } else {
      lines.push('（沒有找到評論，已儲存主文）');
    }

    await ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await ctx.reply(`抓取失敗：${msg}`);
  } finally {
    await ctx.deleteMessage(status.message_id).catch(() => {});
  }
}
