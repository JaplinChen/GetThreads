/**
 * Threads extractor — uses Camoufox for both main post and comments.
 * DOM structure (discovered via analysis):
 *   - Container: [data-pressable-container]
 *   - Spans: span[dir="auto"] — [0]=username, [1]=timestamp, [2]=post text, [3+]=counts
 *   - No article / div[dir="auto"] elements; Threads uses span with dir="auto"
 *   - Public posts are accessible without login.
 */
import type { ExtractedContent, ExtractorWithComments, ThreadComment } from './types.js';
import { camoufoxPool } from '../utils/camoufox-pool.js';

const THREADS_URL_PATTERN =
  /(?:threads\.net|threads\.com)\/@([\w.]+)\/post\/([\w-]+)/i;

/** Extract post text from spans inside a [data-pressable-container].
 *  Span layout: [0]=username, [1]=timestamp, [2]=post text, [3+]=counts.
 *  Strips trailing "  Translate" suffix added by Threads UI.
 */
async function extractSpanText(
  container: import('playwright-core').Locator,
): Promise<string> {
  try {
    const spans = await container.locator('span[dir="auto"]').all();
    if (spans.length < 3) return '';
    // span[0] = username, span[1] = relative time, span[2] = post body
    const raw = await spans[2].innerText().catch(() => '');
    return raw.replace(/\s{2,}Translate\s*$/, '').trim();
  } catch {
    return '';
  }
}

/** Extract scontent CDN image URLs from the page, skip avatars */
async function extractImages(page: import('playwright-core').Page): Promise<string[]> {
  const images: string[] = [];
  try {
    const srcs = await page.evaluate(() =>
      Array.from(document.querySelectorAll('img'))
        .map(img => img.src)
        .filter(Boolean),
    );
    for (const src of srcs) {
      if (
        src.includes('scontent') &&
        !src.includes('s100x100') &&
        !src.includes('s150x150') &&
        !src.includes('s50x50')
      ) {
        images.push(src);
      }
    }
  } catch { /* ignore */ }
  return [...new Set(images)];
}

/** Extract video URLs from the page */
async function extractVideos(page: import('playwright-core').Page): Promise<string[]> {
  const videos: string[] = [];
  try {
    const srcs = await page.evaluate(() =>
      Array.from(document.querySelectorAll('video source, video[src]'))
        .map(el => el.getAttribute('src') ?? '')
        .filter(s => s.includes('.mp4') || s.includes('video')),
    );
    videos.push(...srcs.filter(Boolean));
  } catch { /* ignore */ }
  return [...new Set(videos)];
}

export const threadsExtractor: ExtractorWithComments = {
  platform: 'threads',

  match(url: string): boolean {
    return THREADS_URL_PATTERN.test(url);
  },

  parseId(url: string): string | null {
    return url.match(THREADS_URL_PATTERN)?.[2] ?? null;
  },

  async extract(url: string): Promise<ExtractedContent> {
    const match = url.match(THREADS_URL_PATTERN);
    if (!match) throw new Error(`Invalid Threads URL: ${url}`);
    const [, username] = match;

    const { page, release } = await camoufoxPool.acquire();
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });
      await page.waitForTimeout(2000);

      // Verify we have a post container (not a 404 page)
      const containerCount = await page
        .locator('[data-pressable-container]').count();

      if (containerCount === 0) {
        const bodySnippet = await page
          .evaluate(() => document.body.innerText.slice(0, 300))
          .catch(() => '');
        if (bodySnippet.includes('Log in') || bodySnippet.includes('Sign up')) {
          throw new Error('Threads: 需要登入才能查看此貼文');
        }
        if (bodySnippet.includes("page is gone") || bodySnippet.includes("not working")) {
          throw new Error('Threads: 此貼文不存在或已被刪除');
        }
        throw new Error('Threads: 無法找到貼文容器（頁面結構可能已變更）');
      }

      // First container = the target post
      const firstContainer = page.locator('[data-pressable-container]').first();

      // Validate username: first span[dir=auto] should match the URL username.
      // If a different user appears, we've been redirected to the home feed
      // (happens when the post is deleted or the URL is invalid).
      const firstSpans = await firstContainer.locator('span[dir="auto"]').all();
      if (firstSpans.length > 0) {
        const handleOnPage = (await firstSpans[0].innerText().catch(() => '')).trim();
        if (handleOnPage && handleOnPage.toLowerCase() !== username.toLowerCase()) {
          throw new Error(
            `Threads: 貼文不存在或已被刪除（期望 @${username}，頁面顯示 @${handleOnPage}）`,
          );
        }
      }

      let text = await extractSpanText(firstContainer);

      // Fallback: try reading from page title (Threads sets title = post text)
      if (!text) {
        const pageTitle = await page.title();
        if (pageTitle && !pageTitle.includes('Threads') && pageTitle.length > 5) {
          text = pageTitle;
        }
      }

      if (!text) {
        throw new Error('Threads: 無法提取貼文文字（span[dir=auto] 未找到）');
      }

      // Author: first span in container = @username handle (without @)
      let author = username;
      if (firstSpans.length > 0) {
        const maybeHandle = await firstSpans[0].innerText().catch(() => '');
        if (maybeHandle.trim()) author = maybeHandle.trim();
      }

      // Date: try time element first, then default to today
      const timeAttr = await page
        .locator('time').first().getAttribute('datetime').catch(() => null);
      const date = timeAttr
        ? new Date(timeAttr).toISOString().split('T')[0]
        : new Date().toISOString().split('T')[0];

      const images = await extractImages(page);
      const videoUrls = await extractVideos(page);

      const title = text.split('\n')[0].slice(0, 80);
      return {
        platform: 'threads',
        author,
        authorHandle: `@${username}`,
        title,
        text,
        images,
        videos: videoUrls.map(v => ({ url: v })),
        date,
        url,
      };
    } finally {
      await release();
    }
  },

  async extractComments(url: string, limit = 20): Promise<ThreadComment[]> {
    const { page, release } = await camoufoxPool.acquire();
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });
      await page.waitForTimeout(2000);

      // Scroll to load related threads (comments)
      for (let i = 0; i < 3; i++) {
        await page.evaluate(() => window.scrollBy(0, window.innerHeight));
        await page.waitForTimeout(800);
      }

      // All containers: skip first (original post)
      const containers = await page.locator('[data-pressable-container]').all();
      const comments: ThreadComment[] = [];

      for (const container of containers.slice(1)) {
        if (comments.length >= limit) break;
        try {
          const spans = await container.locator('span[dir="auto"]').all();
          if (spans.length < 3) continue;

          const commentAuthor = await spans[0].innerText().catch(() => '');
          const text = await spans[2].innerText()
            .catch(() => '')
            .then(t => t.replace(/\s{2,}Translate\s*$/, '').trim());

          if (text) {
            // Get handle from link
            const linkHref = await container
              .locator('a[href*="/@"]').first().getAttribute('href').catch(() => '') ?? '';
            const handle = linkHref.replace(/\/@/, '') || commentAuthor;

            comments.push({
              author: commentAuthor.trim() || handle,
              authorHandle: `@${handle}`,
              text,
              date: new Date().toISOString().split('T')[0],
            });
          }
        } catch { /* skip malformed */ }
      }

      return comments;
    } finally {
      await release();
    }
  },
};
