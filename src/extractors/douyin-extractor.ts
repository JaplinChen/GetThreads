/**
 * Douyin / TikTok CN / Toutiao extractor — uses Camoufox for anti-bot bypass.
 * Supports: douyin.com, v.douyin.com short URLs, toutiao.com articles.
 */
import type { ExtractedContent, Extractor } from './types.js';
import { camoufoxPool } from '../utils/camoufox-pool.js';
import { fetchWithTimeout } from '../utils/fetch-with-timeout.js';

const DOUYIN_PATTERN = /douyin\.com\/video\/([\d]+)/i;
const DOUYIN_SHORT = /v\.douyin\.com\/([\w]+)/i;
const TOUTIAO_PATTERN = /toutiao\.com\/(?:i|article)\/([\d]+)/i;

function detectType(url: string): 'douyin' | 'toutiao' {
  return TOUTIAO_PATTERN.test(url) ? 'toutiao' : 'douyin';
}

async function resolveShortUrl(url: string): Promise<string> {
  if (!DOUYIN_SHORT.test(url)) return url;
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

async function extractDouyin(url: string, page: import('playwright-core').Page): Promise<ExtractedContent> {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });
  await page.waitForTimeout(3000);

  // Detect login / verification wall
  const bodySnippet = await page
    .evaluate(() => (document.body ? document.body.innerText.slice(0, 300) : ''))
    .catch(() => '');
  if (
    !bodySnippet ||
    bodySnippet.includes('登录') ||
    bodySnippet.includes('验证') ||
    page.url().includes('login') ||
    page.url().includes('passport')
  ) {
    throw new Error('抖音需要登入或通過驗證才能查看此影片');
  }

  // Wait for video player or description
  await page.waitForSelector('[data-e2e="video-desc"], .video-info-detail, .desc', { timeout: 15_000 });

  const desc = await page.locator('[data-e2e="video-desc"], .video-info-detail, .desc').first().innerText().catch(() => '');
  const author = await page.locator('[data-e2e="video-author-title"], .author-name, .nickname').first().innerText().catch(() => '未知');
  const authorHandle = await page.locator('[data-e2e="video-author-uniqueid"], .unique-id').first().innerText().catch(() => author);

  const likesText = await page.locator('[data-e2e="like-count"], .like-count').first().innerText().catch(() => '0');
  const likes = parseInt(likesText.replace(/[^\d]/g, '') || '0', 10);

  const thumbnail = await page.locator('video[poster]').first().getAttribute('poster').catch(() => null);
  const images = thumbnail ? [thumbnail] : [];

  return {
    platform: 'douyin',
    author: author.trim(),
    authorHandle: `@${authorHandle.replace('@', '').trim()}`,
    title: desc.split('\n')[0].slice(0, 80) || '抖音影片',
    text: desc || '（無文字描述）',
    images,
    videos: [{ url, thumbnailUrl: thumbnail ?? undefined, type: 'video' }],
    date: new Date().toISOString().split('T')[0],
    url,
    likes: likes || undefined,
  };
}

async function extractToutiao(url: string, page: import('playwright-core').Page): Promise<ExtractedContent> {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForSelector('h1, .article-title, .content-header', { timeout: 15_000 });

  const title = await page.locator('h1, .article-title').first().innerText().catch(() => '');
  const author = await page.locator('.author-name, .name').first().innerText().catch(() => '今日頭條');
  const content = await page.locator('article, .article-content, .content').first().innerText().catch(() => '');

  const images: string[] = [];
  const imgEls = await page.locator('article img, .article-content img').all();
  for (const img of imgEls) {
    const src = await img.getAttribute('src');
    if (src) images.push(src);
  }

  return {
    platform: 'douyin',
    author: author.trim(),
    authorHandle: `@${author.trim()}`,
    title: title || content.split('\n')[0].slice(0, 80),
    text: content,
    images,
    videos: [],
    date: new Date().toISOString().split('T')[0],
    url,
  };
}

export const douyinExtractor: Extractor = {
  platform: 'douyin',

  match(url: string): boolean {
    return DOUYIN_PATTERN.test(url) || DOUYIN_SHORT.test(url) || TOUTIAO_PATTERN.test(url);
  },

  parseId(url: string): string | null {
    return (
      url.match(DOUYIN_PATTERN)?.[1] ??
      url.match(DOUYIN_SHORT)?.[1] ??
      url.match(TOUTIAO_PATTERN)?.[1] ??
      null
    );
  },

  async extract(url: string): Promise<ExtractedContent> {
    const resolvedUrl = await resolveShortUrl(url);
    const type = detectType(resolvedUrl);
    const { page, release } = await camoufoxPool.acquire();
    try {
      return type === 'toutiao'
        ? extractToutiao(resolvedUrl, page)
        : extractDouyin(resolvedUrl, page);
    } finally {
      await release();
    }
  },
};
