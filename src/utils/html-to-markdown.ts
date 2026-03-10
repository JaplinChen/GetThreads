/**
 * HTML → Markdown conversion using Readability + Turndown.
 *
 * Provides three entry points:
 *   - htmlToMarkdown(): full-page article extraction via Readability + Turndown
 *   - htmlToMarkdownWithBrowser(): Camoufox fallback for JS-rendered pages
 *   - htmlFragmentToMarkdown(): direct Turndown on an HTML snippet (e.g. GitHub README)
 */

import { parseHTML } from 'linkedom';
import { Readability, isProbablyReaderable } from '@mozilla/readability';
import TurndownService from 'turndown';
// @ts-expect-error — no type declarations for turndown-plugin-gfm
import { gfm } from 'turndown-plugin-gfm';
import { camoufoxPool } from './camoufox-pool.js';

export interface HtmlToMarkdownResult {
  title: string;
  markdown: string;
  excerpt: string;
  byline: string | null;
}

const MAX_MARKDOWN_LENGTH = 8000;

/** Create a configured Turndown instance (shared config) */
function createTurndown(): TurndownService {
  const td = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
  });
  td.use(gfm);

  // Remove badge images (shields.io etc.)
  td.addRule('removeBadges', {
    filter: (node: HTMLElement) => {
      if (node.nodeName !== 'IMG') return false;
      const src = node.getAttribute('src') || '';
      return /shields\.io|badge|img\.shields/i.test(src);
    },
    replacement: () => '',
  });

  // Remove empty anchor links (GitHub heading anchors like [](#section))
  td.addRule('removeEmptyAnchors', {
    filter: (node: HTMLElement) => {
      if (node.nodeName !== 'A') return false;
      return !node.textContent?.trim() && !!node.getAttribute('href')?.startsWith('#');
    },
    replacement: () => '',
  });

  return td;
}

/**
 * Extract article content from a full HTML page using Readability,
 * then convert to Markdown via Turndown.
 *
 * Returns null if the page is not article-like or Readability fails,
 * allowing the caller to fall back to regex-based extraction.
 *
 * @param skipHeuristic - if true, skip isProbablyReaderable check (used for browser-rendered HTML)
 */
export function htmlToMarkdown(
  html: string,
  url: string,
  skipHeuristic = false,
): HtmlToMarkdownResult | null {
  const { document } = parseHTML(html);

  if (!skipHeuristic && !isProbablyReaderable(document)) return null;

  const article = new Readability(document, { charThreshold: 200 }).parse();
  if (!article?.content) return null;

  const td = createTurndown();
  let markdown = td.turndown(article.content);

  if (markdown.length > MAX_MARKDOWN_LENGTH) {
    markdown = markdown.slice(0, MAX_MARKDOWN_LENGTH) + '\n\n...(truncated)';
  }

  return {
    title: (article.title || '').slice(0, 100),
    markdown,
    excerpt: (article.excerpt || '').slice(0, 300),
    byline: article.byline ?? null,
  };
}

/**
 * Fallback: render page with Camoufox browser, then extract with Readability + Turndown.
 * Used when fetch() HTML fails Readability (JS-rendered content).
 */
export async function htmlToMarkdownWithBrowser(url: string): Promise<HtmlToMarkdownResult | null> {
  const { page, release } = await camoufoxPool.acquire();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    // Wait for main content to render
    await page.waitForTimeout(3000);
    const html = await page.content();
    return htmlToMarkdown(html, url, true);
  } finally {
    await release();
  }
}

/**
 * Convert an HTML fragment (not a full page) to Markdown.
 * Used for pre-extracted content like GitHub README <article> blocks.
 */
export function htmlFragmentToMarkdown(htmlFragment: string): string {
  const td = createTurndown();
  let markdown = td.turndown(htmlFragment);

  if (markdown.length > MAX_MARKDOWN_LENGTH) {
    markdown = markdown.slice(0, MAX_MARKDOWN_LENGTH) + '\n\n...(truncated)';
  }

  return markdown;
}
