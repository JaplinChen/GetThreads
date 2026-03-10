export const JINA_REMOVE_SELECTORS = '';
import type { ExtractedContent, Extractor } from './types.js';
import { fetchWithTimeout } from '../utils/fetch-with-timeout.js';
import { stripHtmlTags } from './web-cleaner.js';
import { htmlToMarkdown, htmlToMarkdownWithBrowser } from '../utils/html-to-markdown.js';

function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function extractMeta(html: string, key: string): string {
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${key}["'][^>]+content=["']([^"']+)["'][^>]*>`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${key}["'][^>]*>`, 'i'),
    new RegExp(`<meta[^>]+name=["']${key}["'][^>]+content=["']([^"']+)["'][^>]*>`, 'i'),
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m?.[1]) return decodeHtml(m[1]).trim();
  }
  return '';
}

function extractTitle(html: string): string {
  const ogTitle = extractMeta(html, 'og:title');
  if (ogTitle) return ogTitle.slice(0, 100);
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!m?.[1]) return 'Untitled';
  return decodeHtml(m[1]).replace(/\s+/g, ' ').trim().slice(0, 100) || 'Untitled';
}

/** Regex-based fallback when Readability cannot extract article content */
function extractBodyFallback(html: string): string {
  const noScript = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ');

  const articleMatch = noScript.match(/<(article|main)[^>]*>([\s\S]*?)<\/(article|main)>/i);
  const source = articleMatch?.[2] ?? noScript;
  const text = decodeHtml(stripHtmlTags(source)).replace(/\n{3,}/g, '\n\n').trim();
  return text.length > 6000 ? text.slice(0, 6000) + '\n\n...(truncated)' : text;
}

function absolutizeImage(url: string, pageUrl: string): string {
  try {
    return new URL(url, pageUrl).toString();
  } catch {
    return url;
  }
}

export const webExtractor: Extractor = {
  platform: 'web',

  match(_url: string): boolean {
    return true;
  },

  parseId(url: string): string | null {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return null;
    }
  },

  async extract(url: string): Promise<ExtractedContent> {
    const res = await fetchWithTimeout(url, 30_000, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (GetThreads Bot)',
        Accept: 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
    });

    if (!res.ok) {
      throw new Error(`Web fetch error: ${res.status} ${res.statusText} for ${url}`);
    }

    const html = await res.text();
    if (!html || html.length < 100) throw new Error('Web page returned empty content');

    // Try Readability + Turndown first; if it fails, retry with Camoufox browser;
    // final fallback to regex extraction
    let parsed = htmlToMarkdown(html, res.url || url);
    if (!parsed) {
      try {
        parsed = await htmlToMarkdownWithBrowser(res.url || url);
      } catch {
        // Camoufox unavailable — continue with regex fallback
      }
    }

    let title: string;
    let text: string;

    if (parsed) {
      title = parsed.title || extractTitle(html);
      const description = extractMeta(html, 'description') || extractMeta(html, 'og:description');
      text = [description, parsed.markdown].filter(Boolean).join('\n\n').trim();
    } else {
      title = extractTitle(html);
      const description = extractMeta(html, 'description') || extractMeta(html, 'og:description');
      const body = extractBodyFallback(html);
      text = [description, body].filter(Boolean).join('\n\n').trim();
    }

    if (!text) text = '[No readable text]';

    const imageSet = new Set<string>();
    const ogImage = extractMeta(html, 'og:image');
    if (ogImage) imageSet.add(absolutizeImage(ogImage, res.url || url));

    const imgMatches = html.matchAll(/<img[^>]+src=["']([^"']+)["'][^>]*>/gi);
    for (const m of imgMatches) {
      const src = m[1];
      if (!src || src.startsWith('data:') || src.startsWith('blob:')) continue;
      imageSet.add(absolutizeImage(src, res.url || url));
      if (imageSet.size >= 8) break;
    }

    let domain = url;
    try {
      domain = new URL(res.url || url).hostname.replace(/^www\./, '');
    } catch {
      // keep original
    }

    return {
      platform: 'web',
      author: domain,
      authorHandle: domain,
      title,
      text,
      images: [...imageSet],
      videos: [],
      date: new Date().toISOString().split('T')[0],
      url,
    };
  },
};

