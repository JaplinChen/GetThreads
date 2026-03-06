/**
 * /timeline command — scrapes a user's recent posts via Camoufox.
 * Usage: /timeline @username [threads|x|weibo|bilibili] [count]
 * Default platform: threads (works without login)
 * Note: X.com requires login — not supported without credentials.
 */
import type { Context } from 'telegraf';
import type { AppConfig } from '../utils/config.js';
import type { ExtractedContent } from '../extractors/types.js';
import { camoufoxPool } from '../utils/camoufox-pool.js';
import { saveToVault } from '../saver.js';
import { classifyContent } from '../classifier.js';

type SupportedPlatform = 'threads' | 'x' | 'weibo' | 'bilibili';

interface TimelineResult {
  saved: number;
  skipped: number;
  failed: number;
}

/**
 * Parse a Threads relative/absolute date string to YYYY-MM-DD.
 * Handles: "01/13/26" (MM/DD/YY), "2h", "3d", "4w", "1y".
 */
function parseThreadsDate(dateStr: string): string {
  const today = new Date();
  // Absolute: MM/DD/YY
  const absMatch = dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{2})/);
  if (absMatch) {
    const [, m, d, y] = absMatch;
    return `20${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  // Relative: Nh / Nd / Nw / Ny
  const relMatch = dateStr.match(/(\d+)([hdwy])/);
  if (relMatch) {
    const n = parseInt(relMatch[1], 10);
    const msMap: Record<string, number> = { h: 3_600_000, d: 86_400_000, w: 604_800_000, y: 31_536_000_000 };
    const ms = n * (msMap[relMatch[2]] ?? 86_400_000);
    return new Date(today.getTime() - ms).toISOString().split('T')[0];
  }
  return today.toISOString().split('T')[0];
}

function parseArgs(text: string): { username: string; platform: SupportedPlatform; count: number } | null {
  const parts = text.trim().split(/\s+/).slice(1); // remove /timeline
  if (parts.length === 0) return null;

  let username = parts[0].replace(/^@/, '');
  let platform: SupportedPlatform = 'threads';
  let count = 20;

  for (const part of parts.slice(1)) {
    const lp = part.toLowerCase();
    if (['threads', 'x', 'twitter', 'weibo', 'bilibili'].includes(lp)) {
      platform = lp === 'twitter' ? 'x' : lp as SupportedPlatform;
    } else {
      const n = parseInt(part, 10);
      if (!isNaN(n)) count = Math.min(n, 50);
    }
  }

  // Support full URL as username input
  if (username.startsWith('http')) {
    const m = username.match(/(?:threads\.net|threads\.com|x\.com|twitter\.com|weibo\.com|bilibili\.com)\/@?([\w.]+)/);
    if (m) {
      username = m[1];
      if (username.includes('threads')) platform = 'threads';
      else if (username.includes('x.com') || username.includes('twitter')) platform = 'x';
    }
  }

  return { username, platform, count };
}

/**
 * Scrape Threads user profile page — works without login.
 * Selectors confirmed via DOM analysis: [data-pressable-container], span[dir="auto"].
 */
async function scrapeThreadsTimeline(username: string, count: number): Promise<ExtractedContent[]> {
  const { page, release } = await camoufoxPool.acquire();
  const results: ExtractedContent[] = [];
  try {
    await page.goto(`https://www.threads.net/@${username}`, {
      waitUntil: 'domcontentloaded', timeout: 30_000,
    });
    await page.waitForSelector('[data-pressable-container]', { timeout: 15_000 });

    // Scroll to load more posts (each scroll loads ~5-6 more)
    const scrolls = Math.max(1, Math.ceil(count / 6));
    for (let i = 0; i < scrolls; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
      await page.waitForTimeout(1500);
    }

    const containers = await page.locator('[data-pressable-container]').all();

    for (const container of containers.slice(0, count)) {
      try {
        const postHref = await container.locator('a[href*="/post/"]').first().getAttribute('href').catch(() => '');
        if (!postHref) continue;
        const postUrl = postHref.startsWith('http') ? postHref : `https://www.threads.net${postHref}`;

        const spans = await container.locator('span[dir="auto"]').all();
        if (spans.length < 3) continue;

        const authorOnPage = await spans[0].innerText().catch(() => username);
        const dateStr = await spans[1].innerText().catch(() => '');

        // Collect all text paragraphs from span index 2 onwards
        const textParts: string[] = [];
        for (let i = 2; i < spans.length; i++) {
          const t = await spans[i].innerText().catch(() => '');
          const clean = t.replace(/\s{2,}Translate\s*$/i, '').trim();
          if (clean) textParts.push(clean);
        }
        const fullText = textParts.join('\n').trim();
        if (!fullText) continue;

        // Skip duplicate URLs
        if (results.some(r => r.url === postUrl)) continue;

        results.push({
          platform: 'threads',
          author: authorOnPage || username,
          authorHandle: `@${username}`,
          title: fullText.split('\n')[0].slice(0, 80),
          text: fullText,
          images: [],
          videos: [],
          date: parseThreadsDate(dateStr),
          url: postUrl,
        });
      } catch { /* skip malformed container */ }
    }
  } finally {
    await release();
  }
  return results;
}

export async function handleTimeline(ctx: Context, config: AppConfig): Promise<void> {
  const text = 'text' in ctx.message! ? (ctx.message as { text: string }).text : '';
  const args = parseArgs(text);

  if (!args) {
    await ctx.reply(
      '用法：/timeline @username [threads|weibo|bilibili] [數量]\n' +
      '例：/timeline @zuck threads 10\n' +
      '注意：X/Twitter 需要登入，目前不支援。',
    );
    return;
  }

  const { username, platform, count } = args;

  // X requires login — not supported
  if (platform === 'x') {
    await ctx.reply(
      'X.com 需要帳號登入才能讀取時間軸，目前不支援。\n' +
      '若對方同時有 Threads，可改用：/timeline @username threads',
    );
    return;
  }

  if (platform !== 'threads') {
    await ctx.reply(`${platform} 時間軸功能即將支援，敬請期待。`);
    return;
  }

  const status = await ctx.reply(`正在抓取 Threads 用戶 @${username} 的最近 ${count} 篇貼文...`);

  try {
    const posts = await scrapeThreadsTimeline(username, count);

    if (posts.length === 0) {
      await ctx.reply(`找不到 @${username} 的貼文，請確認帳號名稱是否正確。`);
      return;
    }

    const result: TimelineResult = { saved: 0, skipped: 0, failed: 0 };
    for (const post of posts) {
      try {
        post.category = classifyContent(post.title, post.text);
        const saveResult = await saveToVault(post, config.vaultPath);
        if (saveResult.duplicate) result.skipped++;
        else result.saved++;
      } catch {
        result.failed++;
      }
    }

    await ctx.reply(
      `時間軸抓取完成 @${username} (Threads)\n` +
      `✅ 儲存：${result.saved} 篇\n` +
      `⏭ 略過重複：${result.skipped} 篇\n` +
      `❌ 失敗：${result.failed} 篇`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await ctx.reply(`時間軸抓取失敗：${msg}`);
  } finally {
    await ctx.deleteMessage(status.message_id).catch(() => {});
  }
}
