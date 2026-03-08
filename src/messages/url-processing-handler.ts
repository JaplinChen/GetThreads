import type { Telegraf } from 'telegraf';
import { formatErrorMessage } from '../core/errors.js';
import { logger } from '../core/logger.js';
import type { ExtractorWithComments } from '../extractors/types.js';
import type { AppConfig } from '../utils/config.js';
import { extractUrls, findExtractor } from '../utils/url-parser.js';
import {
  formatDuplicateMessage,
  formatProcessingMessage,
  formatSavedSummary,
  formatUnsupportedUrlMessage,
} from './user-messages.js';
import { enrichExtractedContent } from './services/enrich-content-service.js';
import { extractContentWithComments } from './services/extract-content-service.js';
import { saveExtractedContent } from './services/save-content-service.js';
import type { BotStats } from './types.js';

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
        await ctx.reply(formatUnsupportedUrlMessage(url));
        continue;
      }

      logger.info('msg', 'extracting', { platform: extractor.platform, url });
      stats.urls++;
      const processing = await ctx.reply(formatProcessingMessage(extractor.platform));

      try {
        const content = await extractContentWithComments(url, extractor as ExtractorWithComments);
        await enrichExtractedContent(content, config);

        const result = await saveExtractedContent(content, config.vaultPath);

        if (result.duplicate) {
          await ctx.reply(formatDuplicateMessage(result.mdPath));
          continue;
        }

        stats.saved++;
        if (stats.recent.length >= 50) stats.recent.shift();
        stats.recent.push(`[${content.category}] ${content.title.slice(0, 50)}`);

        await ctx.reply(formatSavedSummary(content, result));
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
