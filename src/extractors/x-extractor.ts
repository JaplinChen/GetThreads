import type { ExtractedContent, ExtractorWithComments, ThreadComment, VideoInfo } from './types.js';
import { fetchWithTimeout } from '../utils/fetch-with-timeout.js';
import { camoufoxPool } from '../utils/camoufox-pool.js';

interface ArticleBlock {
  text: string;
  type: string;
}

interface ArticleMediaEntity {
  media_info?: {
    original_img_url?: string;
  };
}

interface FxTweetResponse {
  code: number;
  message: string;
  tweet: {
    text: string;
    author: {
      name: string;
      screen_name: string;
    };
    media?: {
      photos?: Array<{ url: string }>;
      videos?: Array<{
        url: string;
        thumbnail_url: string;
        type: 'video' | 'gif';
      }>;
    };
    article?: {
      title?: string;
      preview_text?: string;
      cover_media?: {
        media_info?: { original_img_url?: string };
      };
      content?: {
        blocks?: ArticleBlock[];
        media_entities?: ArticleMediaEntity[];
      };
    };
    created_at: string;
    created_timestamp: number;
    likes: number;
    retweets: number;
  };
}

const X_URL_PATTERN = /(?:x\.com|twitter\.com)\/(\w+)\/status\/(\d+)/i;

/**
 * Pick a meaningful title from tweet text.
 * Skips leading lines that are only hashtags / mentions / whitespace,
 * so e.g. "#Tag1 #Tag2\n\nReal content" → "Real content".
 */
function extractTweetTitle(text: string): string {
  const JUNK_LINE = /^[\s#@\p{P}]*$/u;
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !JUNK_LINE.test(trimmed)) {
      return trimmed.slice(0, 80);
    }
  }
  return text.split('\n')[0].slice(0, 80);
}

/** Convert article draft.js blocks to Markdown */
function blocksToMarkdown(blocks: ArticleBlock[]): string {
  const lines: string[] = [];
  let listIndex = 0;

  for (const block of blocks) {
    if (!block.text.trim() && block.type === 'atomic') continue;

    switch (block.type) {
      case 'header-one':
        lines.push(`## ${block.text}`, '');
        listIndex = 0;
        break;
      case 'header-two':
        lines.push(`### ${block.text}`, '');
        listIndex = 0;
        break;
      case 'unordered-list-item':
        lines.push(`- ${block.text}`);
        listIndex = 0;
        break;
      case 'ordered-list-item':
        listIndex++;
        lines.push(`${listIndex}. ${block.text}`);
        break;
      case 'blockquote':
        lines.push(`> ${block.text}`, '');
        listIndex = 0;
        break;
      default:
        if (block.text.trim()) {
          lines.push(block.text, '');
        }
        listIndex = 0;
    }
  }

  return lines.join('\n');
}

export const xExtractor: ExtractorWithComments = {
  platform: 'x',

  match(url: string): boolean {
    return X_URL_PATTERN.test(url);
  },

  parseId(url: string): string | null {
    const match = url.match(X_URL_PATTERN);
    return match?.[2] ?? null;
  },

  async extract(url: string): Promise<ExtractedContent> {
    const match = url.match(X_URL_PATTERN);
    if (!match) throw new Error(`Invalid X.com URL: ${url}`);

    const [, screenName, tweetId] = match;
    const apiUrl = `https://api.fxtwitter.com/${screenName}/status/${tweetId}`;

    const res = await fetchWithTimeout(apiUrl, 30_000);
    if (!res.ok) {
      throw new Error(`FxTwitter API error: ${res.status} ${res.statusText}`);
    }

    const data = (await res.json()) as FxTweetResponse;
    if (data.code !== 200) {
      throw new Error(
        `FxTwitter API returned code ${data.code}: ${data.message}`,
      );
    }

    const { tweet } = data;
    const { article } = tweet;

    // Determine text content: article takes priority over tweet text
    let text: string;
    let title: string;
    if (article?.content?.blocks?.length) {
      title = article.title ?? extractTweetTitle(tweet.text);
      text = blocksToMarkdown(article.content.blocks);
    } else {
      title = extractTweetTitle(tweet.text);
      text = tweet.text;
    }

    // Collect images: article media entities + cover + regular tweet photos
    const images: string[] = [];

    if (article?.cover_media?.media_info?.original_img_url) {
      images.push(article.cover_media.media_info.original_img_url);
    }

    if (article?.content?.media_entities) {
      for (const entity of article.content.media_entities) {
        const imgUrl = entity.media_info?.original_img_url;
        if (imgUrl && !images.includes(imgUrl)) {
          images.push(imgUrl);
        }
      }
    }

    if (tweet.media?.photos) {
      for (const p of tweet.media.photos) {
        if (!images.includes(p.url)) {
          images.push(p.url);
        }
      }
    }

    // Collect videos
    const videos: VideoInfo[] = [];
    if (tweet.media?.videos) {
      for (const v of tweet.media.videos) {
        videos.push({
          url: v.url,
          thumbnailUrl: v.thumbnail_url,
          type: v.type,
        });
      }
    }

    return {
      platform: 'x',
      author: tweet.author.name,
      authorHandle: `@${tweet.author.screen_name}`,
      title,
      text: article?.title ? `# ${article.title}\n\n${text}` : text,
      images,
      videos,
      date: new Date(tweet.created_timestamp * 1000)
        .toISOString()
        .split('T')[0],
      url,
      likes: tweet.likes,
      reposts: tweet.retweets,
    };
  },

  async extractComments(url: string, limit = 20): Promise<ThreadComment[]> {
    const { page, release } = await camoufoxPool.acquire();
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      // Wait for reply tweets to appear
      await page.waitForSelector('[data-testid="tweet"]', { timeout: 15_000 });

      // Scroll to load more replies
      for (let i = 0; i < 3; i++) {
        await page.evaluate(() => window.scrollBy(0, window.innerHeight));
        await page.waitForTimeout(1200);
      }

      const tweetEls = await page.locator('[data-testid="tweet"]').all();
      const comments: ThreadComment[] = [];

      // Skip the first element (the original post)
      for (const el of tweetEls.slice(1)) {
        if (comments.length >= limit) break;
        try {
          const author = await el.locator('[data-testid="User-Name"] span').first().innerText();
          const handle = await el.locator('[data-testid="User-Name"] a').last().getAttribute('href') ?? '';
          const text = await el.locator('[data-testid="tweetText"]').innerText().catch(() => '');
          const timeEl = await el.locator('time').getAttribute('datetime').catch(() => '');
          const date = timeEl ? new Date(timeEl).toISOString().split('T')[0] : '';

          if (text.trim()) {
            comments.push({
              author: author.trim(),
              authorHandle: `@${handle.replace('/', '')}`,
              text: text.trim(),
              date,
            });
          }
        } catch {
          // skip malformed tweet elements
        }
      }

      return comments;
    } finally {
      await release();
    }
  },
};
