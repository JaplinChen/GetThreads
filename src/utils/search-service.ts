/**
 * Search service — DDG (POST + Camoufox), Reddit API, Jina Reader.
 * Shared by /monitor and /google commands.
 */
import type { ExtractedContent } from '../extractors/types.js';
import { fetchWithTimeout } from './fetch-with-timeout.js';
import { camoufoxPool } from './camoufox-pool.js';

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

interface RedditSearchChild {
  data: {
    title: string;
    author: string;
    subreddit: string;
    selftext: string;
    permalink: string;
    score: number;
    created_utc: number;
    url: string;
  };
}

interface RedditSearchResponse {
  data: { children: RedditSearchChild[] };
}

/** Domains filtered from all web searches (irrelevant system pages). */
const SKIP_DOMAINS = [
  'help.x.com', 'support.x.com', 'help.twitter.com', 'support.twitter.com',
  'about.x.com', 'about.twitter.com', 'business.x.com', 'business.twitter.com',
];

function isSkipDomain(hostname: string): boolean {
  return SKIP_DOMAINS.some(d => hostname === d || hostname.endsWith(`.${d}`));
}

export async function searchReddit(keyword: string, limit = 5): Promise<ExtractedContent[]> {
  const url = `https://www.reddit.com/search.json?q=${encodeURIComponent(keyword)}&limit=${limit}&sort=new`;
  try {
    const res = await fetchWithTimeout(url, 20_000, {
      headers: { 'User-Agent': 'GetThreads-Bot/1.0', Accept: 'application/json' },
    });
    if (!res.ok) return [];
    const json = (await res.json()) as RedditSearchResponse;
    return (json.data?.children ?? []).map(c => ({
      platform: 'reddit' as const,
      author: c.data.author,
      authorHandle: `u/${c.data.author}`,
      title: c.data.title,
      text: c.data.selftext || `[Linked: ${c.data.url}]`,
      images: [],
      videos: [],
      date: new Date(c.data.created_utc * 1000).toISOString().split('T')[0],
      url: `https://www.reddit.com${c.data.permalink}`,
      likes: c.data.score,
    }));
  } catch {
    return [];
  }
}

/**
 * DuckDuckGo HTML search (POST) — returns direct URLs, no JS, no CAPTCHA.
 * Auto-detects Chinese queries and uses Traditional Chinese locale (kl=tw-tzh).
 */
export async function searchDuckDuckGo(query: string, limit = 5): Promise<SearchResult[]> {
  try {
    const hasChinese = /[\u4e00-\u9fff\u3400-\u4dbf]/.test(query);
    const kl = hasChinese ? 'tw-tzh' : '';

    const res = await fetchWithTimeout('https://html.duckduckgo.com/html/', 20_000, {
      method: 'POST',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,*/*',
        'Accept-Language': hasChinese ? 'zh-TW,zh;q=0.9,en;q=0.8' : 'en-US,en;q=0.9',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: `q=${encodeURIComponent(query)}&b=&kl=${kl}`,
      redirect: 'follow',
    });
    if (!res.ok) return [];
    const html = await res.text();
    const results: SearchResult[] = [];

    const titleRe =
      /<a[^>]+class="result__a"[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    const snippetRe =
      /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;

    const entries: Array<{ url: string; title: string }> = [];
    for (const m of html.matchAll(titleRe)) {
      const title = m[2].replace(/<[^>]+>/g, '').trim();
      if (!title) continue;
      try {
        if (isSkipDomain(new URL(m[1]).hostname)) continue;
      } catch { continue; }
      entries.push({ url: m[1], title });
    }
    const snippets: string[] = [];
    for (const m of html.matchAll(snippetRe)) {
      snippets.push(m[1].replace(/<[^>]+>/g, '').trim());
    }

    for (let i = 0; i < Math.min(entries.length, limit); i++) {
      results.push({ ...entries[i], snippet: snippets[i] ?? '' });
    }
    return results;
  } catch {
    return [];
  }
}

/** DuckDuckGo search via Camoufox — fallback when POST is rate-limited. */
export async function searchDuckDuckGoCamoufox(query: string, limit = 5): Promise<SearchResult[]> {
  const { page, release } = await camoufoxPool.acquire();
  const results: SearchResult[] = [];
  try {
    const hasChinese = /[\u4e00-\u9fff\u3400-\u4dbf]/.test(query);
    const kl = hasChinese ? 'tw-tzh' : '';
    await page.goto(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=${kl}`,
      { waitUntil: 'domcontentloaded', timeout: 30_000 },
    );

    const links = await page.locator('a.result__a').all();
    const snippetEls = await page.locator('a.result__snippet').all();

    for (let i = 0; i < Math.min(links.length, limit); i++) {
      try {
        const title = await links[i].innerText().catch(() => '');
        const href = await links[i].getAttribute('href').catch(() => '');
        const snippet = i < snippetEls.length
          ? await snippetEls[i].innerText().catch(() => '') : '';
        if (!title || !href) continue;

        const uddgMatch = href.match(/[?&]uddg=(https?%3A%2F%2F[^&]+)/);
        const realUrl = uddgMatch ? decodeURIComponent(uddgMatch[1]) : href;
        if (!realUrl.startsWith('http')) continue;

        try {
          if (isSkipDomain(new URL(realUrl).hostname)) continue;
        } catch { continue; }

        results.push({ title, url: realUrl, snippet });
      } catch { /* skip */ }
    }
  } finally {
    await release();
  }
  return results;
}

/** Web search: DDG POST first (fast), DDG Camoufox fallback (bypasses rate limit). */
export async function webSearch(query: string, limit = 5): Promise<SearchResult[]> {
  const ddg = await searchDuckDuckGo(query, limit);
  if (ddg.length > 0) return ddg;
  return searchDuckDuckGoCamoufox(query, limit);
}

/** Fetch full article via Jina Reader; returns '' on failure. */
export async function fetchJinaContent(url: string): Promise<string> {
  try {
    const { JINA_REMOVE_SELECTORS } = await import('../extractors/web-extractor.js');
    const res = await fetchWithTimeout(`https://r.jina.ai/${url}`, 15_000, {
      headers: {
        Accept: 'text/markdown, text/plain, */*',
        'X-Return-Format': 'markdown',
        'X-Remove-Selector': JINA_REMOVE_SELECTORS,
      },
    });
    if (!res.ok) return '';
    const md = await res.text();
    const BAD = ['Warning: Target URL returned error', 'Access denied', 'Please log in', 'Sign in to'];
    if (md.length < 100 || BAD.some(s => md.includes(s))) return '';
    const lines = md.split('\n');
    let i = 0;
    while (i < lines.length && (/^(Title:|URL Source:|Published Time:)/.test(lines[i].trim()) || !lines[i].trim())) i++;
    return lines.slice(i).join('\n').trim().replace(/!\[.*?\]\(blob:[^)]+\)/g, '').slice(0, 5000);
  } catch { return ''; }
}
