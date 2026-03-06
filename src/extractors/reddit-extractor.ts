/**
 * Reddit extractor — uses Reddit's public JSON API (no authentication required).
 * Based on Agent-Reach's RedditChannel: https://github.com/Panniantong/Agent-Reach
 * Supports post pages: reddit.com/r/{sub}/comments/{id}/...
 */
import type { ExtractedContent, Extractor, ExtractorWithComments, ThreadComment } from './types.js';
import { fetchWithTimeout } from '../utils/fetch-with-timeout.js';

const REDDIT_PATTERN = /reddit\.com\/r\/([\w]+)\/comments\/([\w]+)/i;
const REDDIT_SHORT_PATTERN = /reddit\.com\/r\/[\w]+\/s\/([\w]+)/i;

interface RedditPost {
  title: string;
  selftext: string;
  author: string;
  subreddit: string;
  score: number;
  upvote_ratio: number;
  num_comments: number;
  created_utc: number;
  url: string;
  permalink: string;
  is_self: boolean;
  link_flair_text: string | null;
  thumbnail?: string;
  preview?: {
    images?: Array<{ source: { url: string } }>;
  };
}

interface RedditApiResponse {
  data: {
    children: Array<{
      data: RedditPost;
    }>;
  };
}

interface RedditCommentData {
  author: string;
  body: string;
  created_utc: number;
  score: number;
  replies?: {
    data?: {
      children?: Array<{ kind: string; data?: RedditCommentData }>;
    };
  };
}

/** Recursively parse Reddit comment tree (max depth 2) */
function parseRedditComment(raw: RedditCommentData, depth = 0): ThreadComment {
  const replies: ThreadComment[] = [];
  if (depth < 2 && raw.replies?.data?.children) {
    for (const child of raw.replies.data.children) {
      if (child.kind === 't1' && child.data) {
        replies.push(parseRedditComment(child.data, depth + 1));
      }
    }
  }
  return {
    author: raw.author,
    authorHandle: `u/${raw.author}`,
    text: raw.body,
    date: new Date(raw.created_utc * 1000).toISOString().split('T')[0],
    likes: raw.score,
    ...(replies.length > 0 ? { replies } : {}),
  };
}

/** Build Markdown text from a Reddit post */
function buildText(post: RedditPost): string {
  const lines: string[] = [];

  lines.push(`**r/${post.subreddit}**`);

  const stats = [
    `⬆️ Score: ${post.score.toLocaleString()}`,
    `💬 Comments: ${post.num_comments.toLocaleString()}`,
    `Upvote ratio: ${(post.upvote_ratio * 100).toFixed(0)}%`,
  ];
  lines.push(stats.join(' | '), '');

  if (post.link_flair_text) {
    lines.push(`**Flair:** ${post.link_flair_text}`, '');
  }

  if (post.selftext && post.selftext.trim()) {
    const body = post.selftext.length > 3000
      ? post.selftext.slice(0, 3000) + '\n...'
      : post.selftext;
    lines.push(body);
  } else if (!post.is_self) {
    lines.push(`[Linked content](${post.url})`);
  }

  return lines.join('\n');
}

export const redditExtractor: ExtractorWithComments = {
  platform: 'reddit',

  match(url: string): boolean {
    return REDDIT_PATTERN.test(url) || REDDIT_SHORT_PATTERN.test(url);
  },

  parseId(url: string): string | null {
    return url.match(REDDIT_PATTERN)?.[2] ?? url.match(REDDIT_SHORT_PATTERN)?.[1] ?? null;
  },

  async extract(url: string): Promise<ExtractedContent> {
    // Resolve short URLs by following redirects
    let resolvedUrl = url;
    if (REDDIT_SHORT_PATTERN.test(url) && !REDDIT_PATTERN.test(url)) {
      try {
        const headRes = await fetchWithTimeout(url, 15_000, {
          method: 'GET',
          redirect: 'follow',
          headers: { 'User-Agent': 'GetThreads-Bot/1.0' },
        });
        resolvedUrl = headRes.url;
      } catch {
        throw new Error(`無法解析 Reddit 短連結：${url}`);
      }
    }

    const m = resolvedUrl.match(REDDIT_PATTERN);
    if (!m) throw new Error(`Invalid Reddit URL: ${url}`);

    // Normalize URL and append .json
    const cleanUrl = resolvedUrl.split('?')[0].replace(/\/$/, '');
    const jsonUrl = `${cleanUrl}.json?limit=1`;

    const res = await fetchWithTimeout(jsonUrl, 30_000, {
      headers: {
        'User-Agent': 'GetThreads-Bot/1.0',
        Accept: 'application/json',
      },
    });

    if (!res.ok) {
      throw new Error(`Reddit API error: ${res.status} ${res.statusText}`);
    }

    const json = (await res.json()) as RedditApiResponse[];
    const post = json[0]?.data?.children?.[0]?.data;

    if (!post) {
      throw new Error('Reddit API returned no post data');
    }

    // Extract preview image if available
    const images: string[] = [];
    const preview = post.preview?.images?.[0]?.source?.url;
    if (preview) {
      images.push(preview.replace(/&amp;/g, '&'));
    }

    const date = new Date(post.created_utc * 1000).toISOString().split('T')[0];

    return {
      platform: 'reddit',
      author: post.author,
      authorHandle: `u/${post.author}`,
      title: post.title,
      text: buildText(post),
      images,
      videos: [],
      date,
      url,
      likes: post.score,
      commentCount: post.num_comments,
    };
  },

  async extractComments(url: string, limit = 20): Promise<ThreadComment[]> {
    let resolvedUrl = url;
    if (REDDIT_SHORT_PATTERN.test(url) && !REDDIT_PATTERN.test(url)) {
      const r = await fetchWithTimeout(url, 15_000, {
        headers: { 'User-Agent': 'GetThreads-Bot/1.0' },
        redirect: 'follow',
      });
      resolvedUrl = r.url;
    }
    const cleanUrl = resolvedUrl.split('?')[0].replace(/\/$/, '');
    const jsonUrl = `${cleanUrl}.json?limit=${limit}&depth=2`;
    const res = await fetchWithTimeout(jsonUrl, 30_000, {
      headers: { 'User-Agent': 'GetThreads-Bot/1.0', Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`Reddit comments API error: ${res.status}`);

    const json = (await res.json()) as Array<{ data: { children: Array<{ kind: string; data?: RedditCommentData }> } }>;
    const commentChildren = json[1]?.data?.children ?? [];
    return commentChildren
      .filter(c => c.kind === 't1' && c.data)
      .map(c => parseRedditComment(c.data!))
      .slice(0, limit);
  },
};
