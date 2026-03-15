import type { Extractor } from '../extractors/types.js';

/** Registry of all platform extractors */
const extractors: Extractor[] = [];

export function registerExtractor(extractor: Extractor): void {
  extractors.push(extractor);
}

/** Get all registered extractors (for health probing). */
export function getRegisteredExtractors(): readonly Extractor[] {
  return extractors;
}

/** Find the matching extractor for a URL, or null if unsupported */
export function findExtractor(url: string): Extractor | null {
  return extractors.find((e) => e.match(url)) ?? null;
}

/** Extract all URLs from a text message */
export function extractUrls(text: string): string[] {
  const urlRegex = /https?:\/\/[^\s]+/gi;
  return text.match(urlRegex) ?? [];
}
