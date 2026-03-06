/**
 * /monitor command — cross-platform keyword search (mention discovery).
 * /google command — web search (DuckDuckGo HTML, Google Camoufox fallback).
 * Usage: /monitor <keyword>   /google <query>
 */
import type { Context } from 'telegraf';
import type { AppConfig } from '../utils/config.js';
import type { ExtractedContent } from '../extractors/types.js';
import { fetchWithTimeout } from '../utils/fetch-with-timeout.js';
import { camoufoxPool } from '../utils/camoufox-pool.js';
import { saveToVault } from '../saver.js';
import { classifyContent } from '../classifier.js';

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

async function searchReddit(keyword: string, limit = 5): Promise<ExtractedContent[]> {
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

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

/**
 * Domains to filter from web search (X.com/Twitter help & policy pages that are
 * irrelevant when searching for content mentions).
 */
const SKIP_DOMAINS = [
  'help.x.com', 'support.x.com', 'help.twitter.com', 'support.twitter.com',
  'about.x.com', 'about.twitter.com', 'business.x.com', 'business.twitter.com',
];

/**
 * DuckDuckGo HTML search (POST) — returns direct URLs, no JS, no CAPTCHA.
 * POST avoids DDG redirect wrapping; response has class="result__a" with real URLs.
 * Auto-detects Chinese queries and uses Traditional Chinese locale (kl=tw-tzh)
 * for much better relevance on Chinese-language searches.
 */
async function searchDuckDuckGo(query: string, limit = 5): Promise<SearchResult[]> {
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

    // POST response: <a class="result__a" href="https://real-url.com">Title</a>
    const titleRe =
      /<a[^>]+class="result__a"[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    const snippetRe =
      /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;

    const entries: Array<{ url: string; title: string }> = [];
    for (const m of html.matchAll(titleRe)) {
      const title = m[2].replace(/<[^>]+>/g, '').trim();
      if (!title) continue;
      // Filter out X.com/Twitter help/policy pages (irrelevant system pages)
      try {
        const hostname = new URL(m[1]).hostname;
        if (SKIP_DOMAINS.some(d => hostname === d || hostname.endsWith(`.${d}`))) continue;
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

/**
 * DuckDuckGo search via Camoufox browser — used when DDG POST is rate-limited.
 * The browser version is harder to rate-limit; URLs use duckduckgo.com/l/?uddg= encoding.
 */
async function searchDuckDuckGoCamoufox(query: string, limit = 5): Promise<SearchResult[]> {
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

        // DDG browser links: duckduckgo.com/l/?uddg=URL_ENCODED_REAL_URL
        const uddgMatch = href.match(/[?&]uddg=(https?%3A%2F%2F[^&]+)/);
        const realUrl = uddgMatch ? decodeURIComponent(uddgMatch[1]) : href;
        if (!realUrl.startsWith('http')) continue;

        try {
          const hostname = new URL(realUrl).hostname;
          if (SKIP_DOMAINS.some(d => hostname === d || hostname.endsWith(`.${d}`))) continue;
        } catch { continue; }

        results.push({ title, url: realUrl, snippet });
      } catch { /* skip */ }
    }
  } finally {
    await release();
  }
  return results;
}

/** Web search: DDG POST first (fast), DDG Camoufox as fallback (bypasses rate limit). */
async function webSearch(query: string, limit = 5): Promise<SearchResult[]> {
  const ddg = await searchDuckDuckGo(query, limit);
  if (ddg.length > 0) return ddg;
  return searchDuckDuckGoCamoufox(query, limit);
}

/** Fetch full article via Jina Reader (r.jina.ai); returns '' on failure/block. */
async function fetchJinaContent(url: string): Promise<string> {
  try {
    const res = await fetchWithTimeout(`https://r.jina.ai/${url}`, 15_000, {
      headers: { Accept: 'text/markdown, text/plain, */*', 'X-Return-Format': 'markdown' },
    });
    if (!res.ok) return '';
    const md = await res.text();
    const BAD = ['Warning: Target URL returned error', 'Access denied', 'Please log in', 'Sign in to'];
    if (md.length < 100 || BAD.some(s => md.includes(s))) return '';
    const lines = md.split('\n');
    let i = 0; while (i < lines.length && (/^(Title:|URL Source:|Published Time:)/.test(lines[i].trim()) || !lines[i].trim())) i++;
    return lines.slice(i).join('\n').trim().replace(/!\[.*?\]\(blob:[^)]+\)/g, '').slice(0, 5000);
  } catch { return ''; }
}

export async function handleMonitor(ctx: Context, config: AppConfig): Promise<void> {
  const text = 'text' in ctx.message! ? (ctx.message as { text: string }).text : '';
  const keyword = text.replace(/^\/monitor\s*/i, '').trim();

  if (!keyword) {
    await ctx.reply('用法：/monitor <關鍵字>\n例：/monitor claude code');
    return;
  }

  const status = await ctx.reply(`正在跨平台搜尋「${keyword}」...`);

  try {
    // Parallel: Reddit API + DDG web search (no site: restriction; DDG covers broader web)
    const [redditResults, googleResults] = await Promise.allSettled([
      searchReddit(keyword, 5),
      webSearch(keyword, 8),
    ]);

    const posts = redditResults.status === 'fulfilled' ? redditResults.value : [];
    const rawWeb = googleResults.status === 'fulfilled' ? googleResults.value : [];

    // Exclude x.com/twitter.com: auth required, useless; Reddit already covered by API.
    const MONITOR_SKIP_HOSTS = new Set(['x.com', 'twitter.com', 'www.x.com', 'www.twitter.com']);
    const google = rawWeb.filter(g => {
      try { return !MONITOR_SKIP_HOSTS.has(new URL(g.url).hostname); }
      catch { return false; }
    });

    // Fetch full article via Jina Reader (parallel); fall back to snippet on failure
    const jinaTexts = await Promise.all(google.map(g => fetchJinaContent(g.url).catch(() => '')));
    for (const [i, g] of google.entries()) {
      posts.push({
        platform: 'web',
        author: new URL(g.url).hostname,
        authorHandle: new URL(g.url).hostname,
        title: g.title,
        text: jinaTexts[i] || g.snippet,
        images: [],
        videos: [],
        date: new Date().toISOString().split('T')[0],
        url: g.url,
      });
    }

    if (posts.length === 0) {
      await ctx.reply(`沒有找到關於「${keyword}」的內容。`);
      return;
    }

    let saved = 0;
    for (const post of posts) {
      try {
        post.category = classifyContent(post.title, post.text);
        const r = await saveToVault(post, config.vaultPath);
        if (!r.duplicate) saved++;
      } catch { /* skip */ }
    }

    const lines = [`🔍 搜尋「${keyword}」完成：找到 ${posts.length} 筆，儲存 ${saved} 篇`, ''];
    for (const p of posts.slice(0, 8)) {
      lines.push(`• [${p.title.slice(0, 50)}](${p.url})`);
    }
    await ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await ctx.reply(`搜尋失敗：${msg}`);
  } finally {
    await ctx.deleteMessage(status.message_id).catch(() => {});
  }
}

export async function handleGoogle(ctx: Context, _config: AppConfig): Promise<void> {
  const text = 'text' in ctx.message! ? (ctx.message as { text: string }).text : '';
  const query = text.replace(/^\/google\s*/i, '').trim();

  if (!query) {
    await ctx.reply('用法：/google <查詢>\n例：/google camoufox typescript');
    return;
  }

  const status = await ctx.reply(`正在搜尋「${query}」...`);
  try {
    const results = await webSearch(query, 5);
    if (results.length === 0) {
      await ctx.reply('沒有找到搜尋結果，請稍後再試。');
      return;
    }

    const lines = [`🔍 搜尋「${query}」前 ${results.length} 筆：`, ''];
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      lines.push(`${i + 1}. [${r.title}](${r.url})`);
      if (r.snippet) lines.push(`   _${r.snippet.slice(0, 100)}_`);
    }
    lines.push('', '💡 將上方連結傳給我即可儲存到 Obsidian。');
    await ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await ctx.reply(`搜尋失敗：${msg}`);
  } finally {
    await ctx.deleteMessage(status.message_id).catch(() => {});
  }
}
