/**
 * Post-processing pipeline: runs after extract + AI enrich, before save.
 * Enriches linked URLs and translates non-zh-TW content in parallel.
 * Each step has its own timeout (links: 18s, translation: 15s) to avoid mutual interference.
 */

import type { ExtractedContent } from '../extractors/types.js';
import { logger } from '../core/logger.js';
import { extractUrlsFromText, enrichLinkedUrls, type UrlEntry } from './link-enricher.js';
import { translateIfNeeded } from './translator.js';
import { canonicalizeUrl } from '../utils/url-canonicalizer.js';

export interface PostProcessOptions {
  enrichPostLinks: boolean;
  enrichCommentLinks: boolean;
  translate: boolean;
  maxLinkedUrls: number;
}

function collectUrls(content: ExtractedContent, opts: PostProcessOptions): UrlEntry[] {
  const entries: UrlEntry[] = [];
  const selfUrl = canonicalizeUrl(content.url);

  if (opts.enrichPostLinks) {
    for (const url of extractUrlsFromText(content.text)) {
      if (canonicalizeUrl(url) !== selfUrl) {
        entries.push({ url, source: 'post' });
      }
    }
  }

  if (opts.enrichCommentLinks && content.comments) {
    for (const c of content.comments) {
      for (const url of extractUrlsFromText(c.text)) {
        entries.push({ url, source: 'comment', mentionedBy: c.authorHandle });
      }
      for (const r of c.replies ?? []) {
        for (const url of extractUrlsFromText(r.text)) {
          entries.push({ url, source: 'comment', mentionedBy: r.authorHandle });
        }
      }
    }
  }

  const seen = new Set<string>();
  return entries.filter((e) => {
    const norm = canonicalizeUrl(e.url);
    if (seen.has(norm)) return false;
    seen.add(norm);
    return true;
  }).slice(0, opts.maxLinkedUrls);
}

export async function postProcess(
  content: ExtractedContent,
  opts: PostProcessOptions,
): Promise<void> {
  const urlEntries = collectUrls(content, opts);
  const shouldTranslate = opts.translate;

  if (urlEntries.length === 0 && !shouldTranslate) return;

  const withTimeout = <T>(p: Promise<T>, ms: number, label: string): Promise<T | null> =>
    Promise.race([
      p,
      new Promise<null>((resolve) => {
        setTimeout(() => {
          logger.warn('post-process', `${label} 超時 (${ms}ms)，略過`);
          resolve(null);
        }, ms);
      }),
    ]);

  const [linkedResult, translationResult] = await Promise.allSettled([
    urlEntries.length > 0
      ? withTimeout(enrichLinkedUrls(urlEntries), 18_000, '連結補充')
      : Promise.resolve(null),
    shouldTranslate
      ? withTimeout(translateIfNeeded(content.title, content.text), 15_000, '翻譯')
      : Promise.resolve(null),
  ]);

  if (linkedResult.status === 'fulfilled' && linkedResult.value && Array.isArray(linkedResult.value) && linkedResult.value.length > 0) {
    content.linkedContent = linkedResult.value;
    logger.info('post-process', '補充連結完成', { count: linkedResult.value.length });
  }

  if (translationResult.status === 'fulfilled' && translationResult.value) {
    content.translation = translationResult.value;
    logger.info('post-process', '翻譯完成', { language: translationResult.value.detectedLanguage });
  }
}
