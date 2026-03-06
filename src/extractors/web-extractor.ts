/**
 * Web extractor — uses Jina Reader (r.jina.ai) to extract any web article.
 * Based on Agent-Reach's WebChannel: https://github.com/Panniantong/Agent-Reach
 * Acts as fallback; register LAST so specific extractors take priority.
 */
import type { ExtractedContent, Extractor } from './types.js';
import { fetchWithTimeout } from '../utils/fetch-with-timeout.js';
import {
  cleanWebChrome,
  deduplicateTitle,
  stripFooterSections,
  stripJsonBlocks,
} from './web-cleaner.js';

const JINA_PREFIX = 'https://r.jina.ai/';

/**
 * CSS selectors for noise elements to remove at the HTML level.
 * Jina's X-Remove-Selector strips these BEFORE converting to markdown,
 * so we get clean content from the source — not regex-cleaned afterwards.
 */
export const JINA_REMOVE_SELECTORS = [
  // Structural noise
  'nav', 'footer', 'header', 'aside',
  '[role="navigation"]', '[role="complementary"]', '[role="banner"]',
  // Ads & tracking
  '.ad', '.ads', '.advertisement', '[data-ad]', '.taboola', '.outbrain',
  '.sponsored', '.dfp-ad', '[id*="google_ads"]',
  // Sidebars & widgets
  '.sidebar', '.widget', '.related-posts', '.recommended',
  // Social & sharing
  '.social-share', '.share-buttons', '.share-bar',
  // Subscription & newsletter
  '.newsletter', '.subscribe', '.subscription', '.signup-form',
  // Cookie & popup
  '.cookie-banner', '.cookie-notice', '.popup', '.modal',
  // Author bios (beyond inline bylines)
  '.author-bio', '.author-card', '.author-profile',
].join(', ');

/** Jina Reader error signals — these indicate the target URL was inaccessible */
const JINA_ERROR_SIGNALS = [
  'Warning: Target URL returned error',
  "You've been blocked by network security",
  'Access denied',
  'Error 403',
  'Error 404',
  'Blocked by',
  'Please log in',
  'Sign in to continue',
];

/** Jina metadata prefixes to skip when looking for a title */
const JINA_META_PREFIX = ['Title:', 'URL Source:', 'Published Time:', 'Markdown Content:'];

/** Extract title: first `# Heading` or `Title:` header, skip other Jina metadata */
function parseTitle(markdown: string): string {
  for (const line of markdown.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (JINA_META_PREFIX.some(p => trimmed.startsWith(p) && p !== 'Title:')) continue;
    if (trimmed.startsWith('# ')) return trimmed.slice(2).trim().slice(0, 100);
    if (trimmed.startsWith('Title:')) return trimmed.slice(6).trim().slice(0, 100);
    return trimmed.slice(0, 100);
  }
  return 'Untitled';
}

/** Remove blob: image references (browser-local URLs, useless in vault) */
function removeBlobImages(markdown: string): string {
  return markdown.replace(/!\[.*?\]\(blob:[^)]+\)/g, '');
}

/** Strip Jina Reader metadata block (Title: / URL Source: / Published Time: lines) */
function stripJinaHeader(markdown: string): string {
  const lines = markdown.split('\n');
  let i = 0;
  while (i < lines.length) {
    const trimmed = lines[i].trim();
    if (
      trimmed.startsWith('Title:') ||
      trimmed.startsWith('URL Source:') ||
      trimmed.startsWith('Published Time:') ||
      trimmed === ''
    ) {
      i++;
    } else {
      break;
    }
  }
  return lines.slice(i).join('\n').trim();
}

export const webExtractor: Extractor = {
  platform: 'web',

  match(_url: string): boolean {
    return true; // Fallback — handles any URL
  },

  parseId(url: string): string | null {
    try {
      const u = new URL(url);
      return u.hostname.replace(/^www\./, '');
    } catch {
      return null;
    }
  },

  async extract(url: string): Promise<ExtractedContent> {
    const jinaUrl = `${JINA_PREFIX}${url}`;
    const res = await fetchWithTimeout(jinaUrl, 30_000, {
      headers: {
        Accept: 'text/markdown, text/plain, */*',
        'X-Return-Format': 'markdown',
        'X-Remove-Selector': JINA_REMOVE_SELECTORS,
      },
    });

    if (!res.ok) {
      throw new Error(`Jina Reader error: ${res.status} ${res.statusText} for ${url}`);
    }

    const markdown = await res.text();
    if (!markdown || markdown.length < 50) {
      throw new Error('Jina Reader returned empty content');
    }

    if (JINA_ERROR_SIGNALS.some((s) => markdown.includes(s))) {
      throw new Error(`Jina Reader 無法抓取此頁面（可能需要登入或被封鎖）：${markdown.slice(0, 80)}`);
    }

    const title = parseTitle(markdown);

    // Guard: if the parsed title looks like an error page, reject early
    const ERROR_TITLE_RE = /^(warning[:\s]|error\s*\d{3}|access denied|forbidden|you've been blocked)/i;
    if (ERROR_TITLE_RE.test(title)) {
      throw new Error(`Jina Reader 返回錯誤頁面：${title}`);
    }

    // Pipeline: footer → JSON → blob → header → chrome → dedup title
    const cleaned = cleanWebChrome(
      stripFooterSections(stripJsonBlocks(removeBlobImages(stripJinaHeader(markdown)))),
    );
    const text = deduplicateTitle(cleaned, title);

    // Extract domain as "author" stand-in
    let domain = url;
    try {
      domain = new URL(url).hostname.replace(/^www\./, '');
    } catch {
      // keep raw url
    }

    // Extract images referenced in markdown
    const images: string[] = [];
    const imgRegex = /!\[.*?\]\((https?:\/\/[^)]+)\)/g;
    let match;
    while ((match = imgRegex.exec(text)) !== null) {
      const imgUrl = match[1];
      if (!imgUrl.startsWith('blob:')) {
        images.push(imgUrl);
      }
    }

    return {
      platform: 'web',
      author: domain,
      authorHandle: domain,
      title,
      text,
      images,
      videos: [],
      date: new Date().toISOString().split('T')[0],
      url,
    };
  },
};
