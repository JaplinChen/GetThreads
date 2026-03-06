/**
 * Bilibili extractor — uses Bilibili's public web API (no authentication required).
 * Supports BV video pages and short links (b23.tv).
 */
import type { ExtractedContent, Extractor, ThreadComment } from './types.js';
import { fetchWithTimeout } from '../utils/fetch-with-timeout.js';

const BV_PATTERN = /bilibili\.com\/video\/(BV[\w]+)/i;
const B23_PATTERN = /b23\.tv\/([\w]+)/i;

interface BilibiliApiResponse {
  code: number;
  message: string;
  data: {
    aid: number;
    bvid: string;
    title: string;
    desc: string;
    owner: { name: string; mid: number };
    stat: { view: number; like: number; coin: number; favorite: number; reply: number };
    pic: string;
    pubdate: number;
    pages: Array<{ cid: number; duration: number }>;
  };
}

interface BilibiliCommentReply {
  member: { uname: string };
  content: { message: string };
  ctime: number;
  like: number;
}

interface BilibiliCommentResponse {
  code: number;
  data: {
    replies?: BilibiliCommentReply[];
    page?: { count: number };
  };
}

function parseBvid(url: string): string | null {
  return url.match(BV_PATTERN)?.[1] ?? null;
}

export const bilibiliExtractor: Extractor & {
  extractComments(url: string, limit?: number): Promise<ThreadComment[]>;
} = {
  platform: 'bilibili',

  match(url: string): boolean {
    return BV_PATTERN.test(url) || B23_PATTERN.test(url);
  },

  parseId(url: string): string | null {
    return parseBvid(url) ?? url.match(B23_PATTERN)?.[1] ?? null;
  },

  async extract(url: string): Promise<ExtractedContent> {
    let resolvedUrl = url;

    // Resolve b23.tv short URL
    if (B23_PATTERN.test(url) && !BV_PATTERN.test(url)) {
      const r = await fetchWithTimeout(url, 15_000, { redirect: 'follow' });
      resolvedUrl = r.url;
    }

    const bvid = parseBvid(resolvedUrl);
    if (!bvid) throw new Error(`Invalid Bilibili URL: ${url}`);

    const apiUrl = `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`;
    const res = await fetchWithTimeout(apiUrl, 30_000, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Referer: 'https://www.bilibili.com',
      },
    });

    if (!res.ok) throw new Error(`Bilibili API error: ${res.status}`);

    const json = (await res.json()) as BilibiliApiResponse;
    if (json.code !== 0) throw new Error(`Bilibili API: ${json.message}`);

    const { data } = json;
    const duration = data.pages[0]?.duration ?? 0;
    const durationStr = duration > 0
      ? ` | ⏱ ${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, '0')}`
      : '';

    const stats = [
      `👁 ${data.stat.view.toLocaleString()}`,
      `👍 ${data.stat.like.toLocaleString()}`,
      `⭐ ${data.stat.favorite.toLocaleString()}`,
      `💬 ${data.stat.reply.toLocaleString()}`,
    ].join(' | ');

    const text = [
      stats + durationStr,
      '',
      data.desc || '（無簡介）',
    ].join('\n');

    return {
      platform: 'bilibili',
      author: data.owner.name,
      authorHandle: `uid:${data.owner.mid}`,
      title: data.title,
      text,
      images: [data.pic],
      videos: [{ url: resolvedUrl, thumbnailUrl: data.pic, type: 'video' }],
      date: new Date(data.pubdate * 1000).toISOString().split('T')[0],
      url,
      likes: data.stat.like,
      commentCount: data.stat.reply,
    };
  },

  async extractComments(url: string, limit = 20): Promise<ThreadComment[]> {
    let resolvedUrl = url;
    if (B23_PATTERN.test(url) && !BV_PATTERN.test(url)) {
      const r = await fetchWithTimeout(url, 15_000, { redirect: 'follow' });
      resolvedUrl = r.url;
    }

    const bvid = parseBvid(resolvedUrl);
    if (!bvid) throw new Error(`Invalid Bilibili URL for comments: ${url}`);

    // Get oid (cid) from video info first
    const infoRes = await fetchWithTimeout(
      `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`, 30_000,
      { headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.bilibili.com' } },
    );
    const infoJson = (await infoRes.json()) as BilibiliApiResponse;
    if (infoJson.code !== 0 || !infoJson.data?.aid) {
      throw new Error(`Bilibili API: ${infoJson.message ?? '無法取得影片資訊'}`);
    }
    // Comments API requires numeric aid, not BV id or cid
    const aid = String(infoJson.data.aid);

    const commentUrl = `https://api.bilibili.com/x/v2/reply?type=1&oid=${aid}&pn=1&ps=${limit}&sort=2`;
    const res = await fetchWithTimeout(commentUrl, 30_000, {
      headers: { 'User-Agent': 'Mozilla/5.0', Referer: `https://www.bilibili.com/video/${bvid}` },
    });
    if (!res.ok) throw new Error(`Bilibili comments API error: ${res.status}`);

    const json = (await res.json()) as BilibiliCommentResponse;
    return (json.data?.replies ?? []).map(r => ({
      author: r.member.uname,
      authorHandle: r.member.uname,
      text: r.content.message,
      date: new Date(r.ctime * 1000).toISOString().split('T')[0],
      likes: r.like,
    }));
  },
};
