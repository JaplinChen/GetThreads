/**
 * YouTube extractor — uses yt-dlp to fetch video metadata.
 * Based on Agent-Reach's YouTubeChannel: https://github.com/Panniantong/Agent-Reach
 * Requires yt-dlp installed: https://github.com/yt-dlp/yt-dlp#installation
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ExtractedContent, Extractor } from './types.js';

const execFileAsync = promisify(execFile);

const YOUTUBE_PATTERN = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/i;

interface YtDlpOutput {
  id: string;
  title: string;
  description?: string;
  uploader?: string;
  channel?: string;
  upload_date?: string; // YYYYMMDD
  thumbnail?: string;
  duration_string?: string;
  view_count?: number;
  like_count?: number;
  tags?: string[];
  webpage_url: string;
}

function formatDate(uploadDate?: string): string {
  if (!uploadDate || uploadDate.length !== 8) return new Date().toISOString().split('T')[0];
  const y = uploadDate.slice(0, 4);
  const m = uploadDate.slice(4, 6);
  const d = uploadDate.slice(6, 8);
  return `${y}-${m}-${d}`;
}

/** Build a readable Markdown summary from yt-dlp metadata */
function buildText(data: YtDlpOutput): string {
  const lines: string[] = [];

  if (data.duration_string) lines.push(`**Duration:** ${data.duration_string}`);

  const stats: string[] = [];
  if (data.view_count != null) stats.push(`Views: ${data.view_count.toLocaleString()}`);
  if (data.like_count != null) stats.push(`Likes: ${data.like_count.toLocaleString()}`);
  if (stats.length > 0) lines.push(`**Stats:** ${stats.join(' | ')}`);

  if (data.tags && data.tags.length > 0) {
    lines.push(`**Tags:** ${data.tags.slice(0, 10).join(', ')}`);
  }

  lines.push('');

  if (data.description) {
    // Trim overly long descriptions
    const desc = data.description.length > 2000
      ? data.description.slice(0, 2000) + '\n...'
      : data.description;
    lines.push('## Description', '', desc);
  }

  return lines.join('\n');
}

export const youtubeExtractor: Extractor = {
  platform: 'youtube',

  match(url: string): boolean {
    return YOUTUBE_PATTERN.test(url);
  },

  parseId(url: string): string | null {
    return url.match(YOUTUBE_PATTERN)?.[1] ?? null;
  },

  async extract(url: string): Promise<ExtractedContent> {
    let stdout: string;
    try {
      const result = await execFileAsync('yt-dlp', [
        '--dump-json',
        '--no-playlist',
        '--no-warnings',
        url,
      ], { maxBuffer: 10 * 1024 * 1024, timeout: 120_000 });
      stdout = result.stdout;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('ENOENT') || msg.includes('not found')) {
        throw new Error(
          'yt-dlp is not installed. Install it from https://github.com/yt-dlp/yt-dlp#installation',
        );
      }
      throw new Error(`yt-dlp failed: ${msg}`);
    }

    const data = JSON.parse(stdout) as YtDlpOutput;
    const uploader = data.channel ?? data.uploader ?? 'Unknown';
    const thumbnails = data.thumbnail ? [data.thumbnail] : [];

    return {
      platform: 'youtube',
      author: uploader,
      authorHandle: uploader,
      title: data.title,
      text: buildText(data),
      images: thumbnails,
      videos: [{ url: data.webpage_url, type: 'video' as const }],
      date: formatDate(data.upload_date),
      url,
      likes: data.like_count,
    };
  },
};
