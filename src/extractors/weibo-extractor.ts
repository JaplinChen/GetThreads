/**
 * Weibo extractor — uses Camoufox with $render_data JSON extraction.
 * Weibo API requires login; we extract the embedded SSR JSON from the page instead.
 * Supports weibo.com post URLs and m.weibo.cn mobile pages.
 */
import type { ExtractedContent, Extractor } from './types.js';
import { camoufoxPool } from '../utils/camoufox-pool.js';

// weibo.com/{user_id}/{mid} or m.weibo.cn/detail/{mid}
const WEIBO_PATTERN = /(?:weibo\.com|m\.weibo\.cn)\/(?:[\w.]+\/)?(\d{8,})/i;
const WEIBO_SHORT = /weibo\.com\/(?:[\w.]+)\/(\w+)$/i;

interface WeiboRenderData {
  status?: {
    text?: string;
    user?: { screen_name?: string; name?: string; id?: number };
    created_at?: string;
    reposts_count?: number;
    comments_count?: number;
    attitudes_count?: number;
    mid?: string;
    id?: string;
  };
}

function extractMid(url: string): string | null {
  return url.match(WEIBO_PATTERN)?.[1] ?? null;
}

function cleanWeiboText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<a[^>]*>([^<]*)<\/a>/gi, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .trim();
}

/** Try to extract SSR JSON data from page scripts */
async function extractRenderData(
  page: import('playwright-core').Page,
): Promise<WeiboRenderData | null> {
  try {
    return await page.evaluate(() => {
      // m.weibo.cn embeds post data in window.$render_data
      const raw = (window as unknown as Record<string, unknown>)['$render_data'];
      if (raw) return raw as WeiboRenderData;

      // Fallback: scan script tags for JSON containing "status"
      for (const script of Array.from(document.querySelectorAll('script'))) {
        const src = script.textContent ?? '';
        if (src.includes('"screen_name"') && src.includes('"text"')) {
          const match = src.match(/\{.*"screen_name".*\}/s);
          if (match) {
            try { return JSON.parse(match[0]) as WeiboRenderData; } catch { /* continue */ }
          }
        }
      }
      return null;
    });
  } catch {
    return null;
  }
}

/** Extract images from the page DOM (scontent / wx1 CDN URLs) */
async function extractImages(page: import('playwright-core').Page): Promise<string[]> {
  const imgs: string[] = [];
  try {
    const srcList = await page.evaluate(() =>
      Array.from(document.querySelectorAll('img'))
        .map(img => img.getAttribute('src') ?? '')
        .filter(Boolean),
    );
    for (const src of srcList) {
      if (
        (src.includes('sinaimg') || src.includes('weibo')) &&
        !src.includes('avatar') && !src.includes('_small') && !src.includes('x50')
      ) {
        imgs.push(src);
      }
    }
  } catch { /* ignore */ }
  return imgs;
}

async function fetchViaCamoufox(url: string): Promise<ExtractedContent> {
  const { page, release } = await camoufoxPool.acquire();
  try {
    // Use m.weibo.cn for better SSR data availability
    const mobileUrl = url.includes('m.weibo.cn')
      ? url
      : url.replace('weibo.com', 'm.weibo.cn').replace('/weibo.com', '/m.weibo.cn');

    await page.goto(mobileUrl, { waitUntil: 'networkidle', timeout: 30_000 });

    // Detect Sina Visitor System (anti-bot gate)
    const pageTitle = await page.title();
    if (pageTitle.includes('Visitor') || pageTitle.includes('访客')) {
      // Wait and let Camoufox fingerprinting pass the check (up to 8s)
      await page.waitForTimeout(3000);
      const newTitle = await page.title();
      if (newTitle.includes('Visitor') || newTitle.includes('访客')) {
        throw new Error('微博訪客驗證未通過，可能需要已登入的 Cookie');
      }
    }

    // Try to get SSR JSON first (fastest and most reliable)
    const renderData = await extractRenderData(page);
    const status = renderData?.status;
    if (status?.text) {
      const text = cleanWeiboText(status.text);
      const author = status.user?.name ?? status.user?.screen_name ?? '未知';
      const images = await extractImages(page);
      return {
        platform: 'weibo',
        author,
        authorHandle: `@${status.user?.screen_name ?? author}`,
        title: text.split('\n')[0].slice(0, 80),
        text: [
          `💬 ${status.comments_count ?? 0} | 🔁 ${status.reposts_count ?? 0} | ❤️ ${status.attitudes_count ?? 0}`,
          '',
          text,
        ].join('\n'),
        images,
        videos: [],
        date: status.created_at
          ? (() => { try { return new Date(status.created_at).toISOString().split('T')[0]; } catch { return new Date().toISOString().split('T')[0]; } })()
          : new Date().toISOString().split('T')[0],
        url,
        likes: status.attitudes_count,
        commentCount: status.comments_count,
        reposts: status.reposts_count,
      };
    }

    // DOM fallback: try multiple selector combinations used by m.weibo.cn
    const textSelectors = [
      '.weibo-text', '.WB_text', '.content-text',
      'article .txt', '.card-wrap .txt', 'p.weibo-main-text',
    ];
    let text = '';
    for (const sel of textSelectors) {
      const el = page.locator(sel).first();
      if (await el.count() > 0) {
        text = await el.innerText().catch(() => '');
        if (text.trim()) break;
      }
    }

    const authorSelectors = ['.weibo-name', '.WB_name', '.nick-name', '.name'];
    let author = '未知';
    for (const sel of authorSelectors) {
      const el = page.locator(sel).first();
      if (await el.count() > 0) {
        author = await el.innerText().catch(() => '未知');
        if (author.trim() && author !== '未知') break;
      }
    }

    if (!text.trim()) {
      throw new Error('無法從微博頁面提取內容（可能需要登入或選擇器已過期）');
    }

    const images = await extractImages(page);
    return {
      platform: 'weibo',
      author: author.trim(),
      authorHandle: `@${author.trim()}`,
      title: text.split('\n')[0].slice(0, 80),
      text,
      images,
      videos: [],
      date: new Date().toISOString().split('T')[0],
      url,
    };
  } finally {
    await release();
  }
}

export const weiboExtractor: Extractor = {
  platform: 'weibo',

  match(url: string): boolean {
    return WEIBO_PATTERN.test(url) || WEIBO_SHORT.test(url);
  },

  parseId(url: string): string | null {
    return extractMid(url) ?? url.match(WEIBO_SHORT)?.[1] ?? null;
  },

  async extract(url: string): Promise<ExtractedContent> {
    return fetchViaCamoufox(url);
  },
};
