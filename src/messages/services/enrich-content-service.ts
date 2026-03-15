import { classifyContent } from '../../classifier.js';
import { logger } from '../../core/logger.js';
import { postProcess } from '../../enrichment/post-processor.js';
import type { ExtractedContent } from '../../extractors/types.js';
import { enrichContent } from '../../learning/ai-enricher.js';
import { getTopKeywordsForCategory } from '../../learning/dynamic-classifier.js';
import { AI_TRANSCRIPT_PREFIX } from '../user-messages.js';
import type { AppConfig } from '../../utils/config.js';
import { analyzeContentImages } from '../../utils/vision-llm.js';
import { computeEnrichmentScore } from '../../monitoring/benchmark-scorer.js';
import { loadBenchmarkData, saveBenchmarkData, recordPlatformAttempt } from '../../monitoring/benchmark-store.js';
import { ocrContentImages, isLikelyScreenshot } from '../../enrichment/ocr-service.js';

export async function enrichExtractedContent(content: ExtractedContent, config: AppConfig): Promise<void> {
  content.category = classifyContent(content.title, content.text);
  logger.info('msg', 'category', { category: content.category });

  const hints = getTopKeywordsForCategory(content.category);
  const cleanText = content.text
    .replace(/\*\*Duration:\*\*.*(?:\r?\n|$)/gi, ' ')
    .replace(/\*\*Stats:\*\*.*(?:\r?\n|$)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // OCR: extract text from screenshot-like images when text is minimal
  let ocrText = '';
  if (content.images.length > 0 && cleanText.length < 200 && isLikelyScreenshot(content.url, cleanText)) {
    try {
      ocrText = await ocrContentImages(content.images, cleanText, 2);
      if (ocrText) {
        logger.info('msg', 'ocr-extracted', { chars: ocrText.length });
      }
    } catch (err) {
      logger.warn('msg', 'ocr failed', { message: (err as Error).message });
    }
  }

  // Vision analysis: analyze images when text is insufficient
  let imageContext = '';
  if (content.images.length > 0 && cleanText.length < 200) {
    try {
      imageContext = await analyzeContentImages(content.images, 2);
      if (imageContext) {
        content.imageDescriptions = imageContext;
        logger.info('msg', 'vision-analysis', { chars: imageContext.length });
      }
    } catch (err) {
      logger.warn('msg', 'vision-analysis failed', { message: (err as Error).message });
    }
  }

  let textForAI = content.transcript
    ? `${cleanText}${AI_TRANSCRIPT_PREFIX}${content.transcript.slice(0, 2500)}`
    : cleanText;
  if (ocrText) textForAI += `\n\n[OCR 文字辨識]\n${ocrText.slice(0, 1500)}`;
  const finalText = imageContext
    ? `${textForAI}\n\n[圖片視覺描述]\n${imageContext}`
    : textForAI;
  const enriched = await enrichContent(content.title, finalText, hints);
  if (enriched.keywords) content.enrichedKeywords = enriched.keywords;
  if (enriched.summary) content.enrichedSummary = enriched.summary;
  if (enriched.analysis) content.enrichedAnalysis = enriched.analysis;
  if (enriched.keyPoints?.length) content.enrichedKeyPoints = enriched.keyPoints;
  if (enriched.title) content.title = enriched.title;
  // 不用 enricher 的 category — classifier 的關鍵字匹配更可靠

  // Benchmark: score enrichment quality (non-blocking)
  try {
    const score = computeEnrichmentScore(enriched, content.title, finalText);
    const benchData = await loadBenchmarkData();
    benchData.scores[content.url] = {
      score,
      timestamp: new Date().toISOString(),
      platform: content.platform,
    };
    recordPlatformAttempt(benchData, content.platform, true);
    await saveBenchmarkData(benchData);
    logger.info('benchmark', '品質評分', { url: content.url, score: score.overall });
  } catch {
    // Non-critical, silent fallback
  }

  try {
    await postProcess(content, {
      enrichPostLinks: true,
      enrichCommentLinks: true,
      translate: config.enableTranslation,
      maxLinkedUrls: config.maxLinkedUrls,
    });
  } catch (err) {
    logger.warn('post-process', 'post process failed', { message: (err as Error).message });
  }
}
