import { Telegraf } from 'telegraf';
import { rm } from 'node:fs/promises';
import type { AppConfig } from './utils/config.js';
import { extractUrls, findExtractor } from './utils/url-parser.js';
import { saveToVault } from './saver.js';
import { classifyContent } from './classifier.js';
import { enrichContent } from './learning/ai-enricher.js';
import { getTopKeywordsForCategory } from './learning/dynamic-classifier.js';
import type { ExtractorWithComments } from './extractors/types.js';
import { postProcess } from './enrichment/post-processor.js';
import { registerCommands, formatErrorMessage } from './commands/register-commands.js';
import { parseForceReplyTag } from './utils/force-reply.js';

const startTime = Date.now();
const stats = { urls: 0, saved: 0, errors: 0, recent: [] as string[] };

/** Check if a Telegram user is allowed to use this bot */
function isAuthorized(config: AppConfig, userId: number | undefined): boolean {
  if (!config.allowedUserIds || config.allowedUserIds.size === 0) return true;
  return userId !== undefined && config.allowedUserIds.has(userId);
}

/** Filter out noise: too short, pure emoji, or generic one-word reactions */
function isMeaningfulComment(c: { text: string }): boolean {
  const t = c.text.trim();
  if (!t) return false;
  if (/https?:\/\/\S+|(?:^|\s)\w+\.\w{2,}\/\S+/.test(t)) return true;
  if (t.length < 15) return false;
  if (/^[\p{Emoji}\s!?.。，！？]+$/u.test(t)) return false;
  if (/^(great|nice|wow|lol|haha|yes|ok|okay|cool|love|good|awesome|amazing|thanks|congrats?)[\s!.！。]*$/i.test(t)) return false;
  return true;
}

export function createBot(config: AppConfig): Telegraf {
  const bot = new Telegraf(config.botToken, {
    handlerTimeout: 90_000,
  });

  // Auth middleware — all handlers below require authorization
  bot.use((ctx, next) => {
    if (!isAuthorized(config, ctx.from?.id)) {
      console.warn('[auth] Unauthorized from user ID:', ctx.from?.id);
      return;
    }
    return next();
  });

  // Register all /commands (extracted to keep bot.ts under 300 lines)
  registerCommands(bot, config, stats, startTime);

  // ForceReply interceptor — route replies to the original command
  bot.on('message', (ctx, next) => {
    if (!ctx.message || !('text' in ctx.message)) return next();
    const replyTo = ctx.message.reply_to_message;
    if (!replyTo || !('text' in replyTo) || !replyTo.from?.is_bot) return next();
    const cmd = parseForceReplyTag(replyTo.text);
    if (!cmd) return next();
    (ctx.message as unknown as Record<string, unknown>).text = `/${cmd} ${ctx.message.text}`;
    return next();
  });

  // URL message handler — core save-to-vault logic
  bot.on('message', async (ctx) => {
    const text = 'text' in ctx.message ? ctx.message.text : undefined;
    console.log('[msg] received:', text?.slice(0, 80));
    if (!text) return;

    const urls = extractUrls(text);
    console.log('[msg] urls:', urls);
    if (urls.length === 0) return;

    for (const url of urls) {
      const extractor = findExtractor(url);
      if (!extractor) {
        console.log('[msg] unsupported:', url);
        await ctx.reply(`不支援的連結：${url}`);
        continue;
      }

      console.log('[msg] extracting:', extractor.platform, url);
      stats.urls++;
      const processing = await ctx.reply(`正在處理 ${extractor.platform} 連結...`);

      try {
        const withComments = extractor as Partial<ExtractorWithComments>;
        const hasComments = typeof withComments.extractComments === 'function';
        const [contentResult, commentsResult] = await Promise.allSettled([
          extractor.extract(url),
          hasComments ? withComments.extractComments!(url, 30) : Promise.resolve([]),
        ]);
        if (contentResult.status === 'rejected') throw contentResult.reason as Error;
        const content = contentResult.value;
        console.log('[msg] extracted:', content.title);

        if (commentsResult.status === 'fulfilled' && commentsResult.value.length > 0) {
          const meaningful = commentsResult.value.filter(isMeaningfulComment);
          if (meaningful.length > 0) {
            content.comments = meaningful;
            content.commentCount = commentsResult.value.length;
          }
        }

        content.category = classifyContent(content.title, content.text);
        console.log('[msg] category:', content.category);

        if (config.anthropicApiKey) {
          const hints = getTopKeywordsForCategory(content.category);
          const textForAI = content.transcript
            ? `${content.text}\n\n文字稿：${content.transcript.slice(0, 500)}` : content.text;
          const enriched = await enrichContent(
            content.title, textForAI, hints, config.anthropicApiKey,
          );
          if (enriched.keywords) content.enrichedKeywords = enriched.keywords;
          if (enriched.summary) content.enrichedSummary = enriched.summary;
          if (enriched.title) content.title = enriched.title;
          if (enriched.category) content.category = enriched.category;
        }

        try {
          await postProcess(content, config.anthropicApiKey, {
            enrichPostLinks: true,
            enrichCommentLinks: true,
            translate: config.enableTranslation,
            maxLinkedUrls: config.maxLinkedUrls,
          });
        } catch (err) {
          console.warn('[postProcess] 補充處理失敗:', (err as Error).message);
        }

        const result = await saveToVault(content, config.vaultPath);
        if (content.tempDir) {
          rm(content.tempDir, { recursive: true, force: true }).catch(() => {});
        }
        console.log('[msg] saved:', result.mdPath);

        if (result.duplicate) {
          await ctx.reply(`已儲存過，略過：\n${result.mdPath}`);
          continue;
        }

        stats.saved++;
        if (stats.recent.length >= 50) stats.recent.shift();
        stats.recent.push(`[${content.category}] ${content.title.slice(0, 50)}`);

        const summary = [
          `已儲存：${content.author} (${content.authorHandle})`,
          `分類：${content.category}`,
          '',
          content.text.length > 200 ? content.text.slice(0, 200) + '...' : content.text,
          '',
          `圖片：${result.imageCount} | 影片：${result.videoCount}${content.comments?.length ? ` | 評論：${content.comments.length}` : ''}`,
          `檔案：${result.mdPath}`,
        ].join('\n');
        await ctx.reply(summary);
      } catch (err) {
        console.error('[msg] error processing url:', url, err);
        stats.errors++;
        await ctx.reply(formatErrorMessage(err));
      }

      try { await ctx.deleteMessage(processing.message_id); } catch { /* ignore */ }
    }
  });

  return bot;
}
