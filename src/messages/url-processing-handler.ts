import { rm } from 'node:fs/promises';
import type { Telegraf } from 'telegraf';
import { classifyContent } from '../classifier.js';
import { formatErrorMessage } from '../core/errors.js';
import { logger } from '../core/logger.js';
import { postProcess } from '../enrichment/post-processor.js';
import type { ExtractorWithComments } from '../extractors/types.js';
import { enrichContent } from '../learning/ai-enricher.js';
import { getTopKeywordsForCategory } from '../learning/dynamic-classifier.js';
import { saveToVault } from '../saver.js';
import type { AppConfig } from '../utils/config.js';
import { extractUrls, findExtractor } from '../utils/url-parser.js';
import type { BotStats } from './types.js';

/** Filter out noise: too short, pure emoji, or generic one-word reactions */
function isMeaningfulComment(c: { text: string }): boolean {
  const t = c.text.trim();
  if (!t) return false;
  if (/https?:\/\/\S+|(?:^|\s)\w+\.\w{2,}\/\S+/.test(t)) return true;
  if (t.length < 15) return false;
  if (/^[\p{Emoji}\s!?.\u3002\uFF0C\uFF01\uFF1F]+$/u.test(t)) return false;
  if (/^(great|nice|wow|lol|haha|yes|ok|okay|cool|love|good|awesome|amazing|thanks|congrats?)[\s!.\uFF01\u3002]*$/i.test(t)) return false;
  return true;
}

export function registerUrlProcessingHandler(
  bot: Telegraf,
  config: AppConfig,
  stats: BotStats,
): void {
  bot.on('message', async (ctx) => {
    const text = 'text' in ctx.message ? ctx.message.text : undefined;
    logger.info('msg', 'received', { preview: text?.slice(0, 80) });
    if (!text) return;

    const urls = extractUrls(text);
    logger.info('msg', 'urls', { urls });
    if (urls.length === 0) return;

    for (const url of urls) {
      const extractor = findExtractor(url);
      if (!extractor) {
        logger.warn('msg', 'unsupported url', { url });
        await ctx.reply(`銝?渡????嚗?{url}`);
        continue;
      }

      logger.info('msg', 'extracting', { platform: extractor.platform, url });
      stats.urls++;
      const processing = await ctx.reply(`甇??? ${extractor.platform} ???...`);

      try {
        const withComments = extractor as Partial<ExtractorWithComments>;
        const hasComments = typeof withComments.extractComments === 'function';
        const [contentResult, commentsResult] = await Promise.allSettled([
          extractor.extract(url),
          hasComments ? withComments.extractComments!(url, 30) : Promise.resolve([]),
        ]);
        if (contentResult.status === 'rejected') throw contentResult.reason as Error;
        const content = contentResult.value;
        logger.info('msg', 'extracted', { title: content.title });

        if (commentsResult.status === 'fulfilled' && commentsResult.value.length > 0) {
          const meaningful = commentsResult.value.filter(isMeaningfulComment);
          if (meaningful.length > 0) {
            content.comments = meaningful;
            content.commentCount = commentsResult.value.length;
          }
        }

        content.category = classifyContent(content.title, content.text);
        logger.info('msg', 'category', { category: content.category });

        if (config.anthropicApiKey) {
          const hints = getTopKeywordsForCategory(content.category);
          const textForAI = content.transcript
            ? `${content.text}\n\n??蝔選?${content.transcript.slice(0, 500)}`
            : content.text;
          const enriched = await enrichContent(content.title, textForAI, hints, config.anthropicApiKey);
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
          logger.warn('post-process', '鋆???憭望?', { message: (err as Error).message });
        }

        const result = await saveToVault(content, config.vaultPath);
        if (content.tempDir) {
          rm(content.tempDir, { recursive: true, force: true }).catch(() => {});
        }
        logger.info('msg', 'saved', { mdPath: result.mdPath });

        if (result.duplicate) {
          await ctx.reply(`撌脣摮?嚗??\n${result.mdPath}`);
          continue;
        }

        stats.saved++;
        if (stats.recent.length >= 50) stats.recent.shift();
        stats.recent.push(`[${content.category}] ${content.title.slice(0, 50)}`);

        const summary = [
          `撌脣摮?${content.author} (${content.authorHandle})`,
          `??嚗?{content.category}`,
          '',
          content.text.length > 200 ? content.text.slice(0, 200) + '...' : content.text,
          '',
          `??嚗?{result.imageCount} | 敶梁?嚗?{result.videoCount}${content.comments?.length ? ` | 閰?嚗?{content.comments.length}` : ''}`,
          `瑼?嚗?{result.mdPath}`,
        ].join('\n');
        await ctx.reply(summary);
      } catch (err) {
        logger.error('msg', 'error processing url', { url, err });
        stats.errors++;
        await ctx.reply(formatErrorMessage(err));
      }

      try {
        await ctx.deleteMessage(processing.message_id);
      } catch {
        // ignore
      }
    }
  });
}
