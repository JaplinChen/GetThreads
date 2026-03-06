/**
 * Xiaohongshu (小紅書) extractor — uses Camoufox (no public API available).
 * Supports xiaohongshu.com/explore/{id} and xhslink.com short URLs.
 */
import type { ExtractedContent, Extractor } from './types.js';
import { camoufoxPool } from '../utils/camoufox-pool.js';
import { fetchWithTimeout } from '../utils/fetch-with-timeout.js';

const XHS_PATTERN = /xiaohongshu\.com\/explore\/([\w]+)/i;
const XHS_LINK_PATTERN = /xhslink\.com\/([\w]+)/i;
const XHS_DISCOVER_PATTERN = /xiaohongshu\.com\/discovery\/item\/([\w]+)/i;

function parseNoteId(url: string): string | null {
  return (
    url.match(XHS_PATTERN)?.[1] ??
    url.match(XHS_DISCOVER_PATTERN)?.[1] ??
    url.match(XHS_LINK_PATTERN)?.[1] ??
    null
  );
}

async function resolveShortUrl(url: string): Promise<string> {
  if (!XHS_LINK_PATTERN.test(url)) return url;
  try {
    const res = await fetchWithTimeout(url, 15_000, {
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' },
    });
    return res.url;
  } catch {
    return url;
  }
}

export const xiaohongshuExtractor: Extractor = {
  platform: 'xiaohongshu',

  match(url: string): boolean {
    return XHS_PATTERN.test(url) || XHS_LINK_PATTERN.test(url) || XHS_DISCOVER_PATTERN.test(url);
  },

  parseId(url: string): string | null {
    return parseNoteId(url);
  },

  async extract(url: string): Promise<ExtractedContent> {
    const resolvedUrl = await resolveShortUrl(url);
    const { page, release } = await camoufoxPool.acquire();
    try {
      await page.goto(resolvedUrl, { waitUntil: 'networkidle', timeout: 30_000 });
      await page.waitForTimeout(2000);

      // Detect login wall (URL-based and body-text-based)
      const currentUrl = page.url();
      const bodySnippet = await page
        .evaluate(() => document.body?.innerText?.slice(0, 200) ?? '')
        .catch(() => '');
      if (
        currentUrl.includes('/login') ||
        currentUrl.includes('/signin') ||
        bodySnippet.includes('登录') ||
        bodySnippet.includes('登入') ||
        bodySnippet.includes('手机号登录') ||
        bodySnippet.includes('扫码')
      ) {
        throw new Error('小紅書需要登入才能查看此內容（無法在未登入情況下抓取）');
      }

      // Wait for note content
      await page.waitForSelector('#detail-desc, .desc, .note-content', { timeout: 15_000 });

      const title = await page.locator('#detail-title, .title, h1').first().innerText().catch(() => '');
      const desc = await page.locator('#detail-desc, .desc, .note-content').first().innerText().catch(() => '');
      const author = await page.locator('.author-name, .username, .user-nickname').first().innerText().catch(() => '未知');
      const authorHandle = await page.locator('.author-wrapper a, .user-info a').first().getAttribute('href').catch(() => '') ?? '';

      // Extract images
      const images: string[] = [];
      const imgEls = await page.locator('.note-image img, .swiper-slide img, .media-container img').all();
      for (const img of imgEls) {
        const src = await img.getAttribute('src') ?? await img.getAttribute('data-src');
        if (src && !src.includes('avatar') && !src.includes('icon')) {
          images.push(src);
        }
      }

      // Likes and engagement
      const likes = await page.locator('[class*="like"] span, .like-wrapper span').first()
        .innerText().catch(() => '0');
      const likesNum = parseInt(likes.replace(/[^\d]/g, '') || '0', 10);

      const text = desc || title;
      const noteTitle = title || text.split('\n')[0].slice(0, 80);

      return {
        platform: 'xiaohongshu',
        author: author.trim(),
        authorHandle: authorHandle ? `@${authorHandle.split('/').pop()}` : `@${author.trim()}`,
        title: noteTitle,
        text,
        images: [...new Set(images)],
        videos: [],
        date: new Date().toISOString().split('T')[0],
        url: resolvedUrl,
        likes: likesNum || undefined,
      };
    } finally {
      await release();
    }
  },
};
