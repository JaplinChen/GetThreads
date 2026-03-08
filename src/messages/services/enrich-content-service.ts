import { classifyContent } from '../../classifier.js';
import { logger } from '../../core/logger.js';
import { postProcess } from '../../enrichment/post-processor.js';
import type { ExtractedContent } from '../../extractors/types.js';
import { enrichContent } from '../../learning/ai-enricher.js';
import { getTopKeywordsForCategory } from '../../learning/dynamic-classifier.js';
import { AI_TRANSCRIPT_PREFIX } from '../user-messages.js';
import type { AppConfig } from '../../utils/config.js';

export async function enrichExtractedContent(content: ExtractedContent, config: AppConfig): Promise<void> {
  content.category = classifyContent(content.title, content.text);
  logger.info('msg', 'category', { category: content.category });

  if (config.anthropicApiKey) {
    const hints = getTopKeywordsForCategory(content.category);
    const textForAI = content.transcript
      ? `${content.text}${AI_TRANSCRIPT_PREFIX}${content.transcript.slice(0, 500)}`
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
    logger.warn('post-process', 'post process failed', { message: (err as Error).message });
  }
}
