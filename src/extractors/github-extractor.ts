import type { ExtractedContent, Extractor } from './types.js';
import { fetchWithTimeout } from '../utils/fetch-with-timeout.js';
import { htmlFragmentToMarkdown } from '../utils/html-to-markdown.js';

const GITHUB_PATTERN = /github\.com\/([\w.-]+)\/([\w.-]+)(?:\/(?:issues|pull)\/(\d+))?/i;

function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'");
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

function extractReadmeMarkdown(html: string): string {
  const m = html.match(/<article[^>]*class=["'][^"']*markdown-body[^"']*["'][^>]*>([\s\S]*?)<\/article>/i);
  if (!m?.[1]) return '';
  return htmlFragmentToMarkdown(m[1]);
}

export const githubExtractor: Extractor = {
  platform: 'github',

  match(url: string): boolean {
    return GITHUB_PATTERN.test(url);
  },

  parseId(url: string): string | null {
    const m = url.match(GITHUB_PATTERN);
    if (!m) return null;
    return m[3] ? `${m[1]}-${m[2]}-${m[3]}` : `${m[1]}-${m[2]}`;
  },

  async extract(url: string): Promise<ExtractedContent> {
    const m = url.match(GITHUB_PATTERN);
    if (!m) throw new Error(`Invalid GitHub URL: ${url}`);

    const [, owner, repo, number] = m;
    const res = await fetchWithTimeout(url, 30_000, {
      headers: { 'User-Agent': 'Mozilla/5.0 (GetThreads Bot)' },
    });
    if (!res.ok) {
      throw new Error(`GitHub page error: ${res.status} ${res.statusText}`);
    }

    const html = await res.text();
    const isIssue = url.includes('/issues/');
    const isPR = url.includes('/pull/');

    const ogTitle = extractMeta(html, 'og:title');
    const ogDescription = extractMeta(html, 'og:description');
    const ogImage = extractMeta(html, 'og:image');

    let title = ogTitle || `${owner}/${repo}`;
    let text = ogDescription || '[No description]';

    if ((isIssue || isPR) && number) {
      const kind = isPR ? 'PR' : 'Issue';
      title = `[${kind} #${number}] ${title}`;
    } else {
      const readme = extractReadmeMarkdown(html);
      if (readme) text = `${text}\n\n${readme}`;
    }

    return {
      platform: 'github',
      author: owner,
      authorHandle: `@${owner}`,
      title: title.slice(0, 120),
      text,
      body: !isIssue && !isPR ? extractReadmeMarkdown(html) || undefined : undefined,
      images: ogImage ? [ogImage] : [],
      videos: [],
      date: new Date().toISOString().split('T')[0],
      url,
    };
  },
};
