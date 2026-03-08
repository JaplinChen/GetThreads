/**
 * YouTube extractor — uses yt-dlp to fetch video/playlist metadata.
 * Supports: single videos, shorts, embeds, and playlists.
 * Requires yt-dlp installed: https://github.com/yt-dlp/yt-dlp#installation
 */
import { execFile } from 'node:child_process';
import { logger } from '../core/logger.js';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdir, rm, access } from 'node:fs/promises';
import type { ExtractedContent, Extractor, VideoInfo } from './types.js';

const execFileAsync = promisify(execFile);

const VIDEO_PATTERN = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/i;
const PLAYLIST_PATTERN = /youtube\.com\/playlist\?(?:.*&)?list=([\w-]+)/i;

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

interface YtDlpPlaylistEntry {
  id: string;
  title: string;
  url: string;
  webpage_url?: string;
  duration?: number;
  duration_string?: string;
  view_count?: number;
  thumbnail?: string;
  description?: string;
  upload_date?: string;
}

interface YtDlpPlaylistOutput {
  title: string;
  uploader?: string;
  channel?: string;
  description?: string;
  webpage_url: string;
  entries: YtDlpPlaylistEntry[];
}

function formatDate(uploadDate?: string): string {
  if (!uploadDate || uploadDate.length !== 8) return new Date().toISOString().split('T')[0];
  return `${uploadDate.slice(0, 4)}-${uploadDate.slice(4, 6)}-${uploadDate.slice(6, 8)}`;
}

function formatDuration(seconds?: number): string {
  if (!seconds) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Build Markdown text from single video metadata */
function buildVideoText(data: YtDlpOutput): string {
  const lines: string[] = [];

  if (data.duration_string) lines.push(`**Duration:** ${data.duration_string}`);

  const stats: string[] = [];
  if (data.view_count != null) stats.push(`Views: ${data.view_count.toLocaleString()}`);
  if (stats.length > 0) lines.push(`**Stats:** ${stats.join(' | ')}`);

  if (data.tags && data.tags.length > 0) {
    lines.push(`**Tags:** ${data.tags.slice(0, 10).join(', ')}`);
  }

  lines.push('');

  if (data.description) {
    const desc = data.description.length > 2000
      ? data.description.slice(0, 2000) + '\n...'
      : data.description;
    lines.push('## Description', '', desc);
  }

  return lines.join('\n');
}

/** Clean video description: remove promo links, timestamps, social media spam */
function cleanDescription(desc?: string): string {
  if (!desc) return '';
  const lines = desc.split('\n').filter(line => {
    const t = line.trim();
    if (!t) return false;
    // Remove promo lines (👉, social links, subscribe)
    if (/^👉|^🔗|^📌|^▶/.test(t)) return false;
    if (/facebook\.com|instagram\.com|substack\.com|twitter\.com|x\.com|linktr\.ee/i.test(t)) return false;
    if (/訂閱|subscribe|追蹤|follow/i.test(t)) return false;
    // Remove timestamp lines (00:00 ...)
    if (/^\d{1,2}:\d{2}/.test(t)) return false;
    // Remove separator lines
    if (/^[-=_]{3,}$/.test(t)) return false;
    return true;
  });
  const cleaned = lines.join('\n').trim();
  return cleaned.length > 500 ? cleaned.slice(0, 500) + '...' : cleaned;
}

/** Build Markdown text from playlist metadata (title + video + summary) */
function buildPlaylistText(data: YtDlpPlaylistOutput): string {
  const lines: string[] = [];
  lines.push(`**影片數量：** ${data.entries.length}`);
  lines.push('');

  for (let i = 0; i < data.entries.length; i++) {
    const e = data.entries[i];
    const dur = e.duration_string ?? formatDuration(e.duration);
    const durStr = dur ? ` (${dur})` : '';

    lines.push(`### ${i + 1}. ${e.title}${durStr}`, '');
    lines.push(`{{VIDEO:${i}}}`, '');
    const summary = cleanDescription(e.description);
    if (summary) lines.push(summary, '');
  }

  return lines.join('\n');
}

function isPlaylistUrl(url: string): boolean {
  return PLAYLIST_PATTERN.test(url);
}

async function extractVideo(url: string): Promise<ExtractedContent> {
  let stdout: string;
  try {
    const result = await execFileAsync('yt-dlp', [
      '--dump-json', '--no-playlist', '--no-warnings', url,
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

  // Download video file (720p max, mp4)
  const tmpDir = join(tmpdir(), `getthreads-yt-${data.id}`);
  await mkdir(tmpDir, { recursive: true });
  const videoPath = join(tmpDir, 'video.mp4');

  let localPath: string | undefined;
  try {
    await execFileAsync('yt-dlp', [
      '-f', 'bestvideo[height<=720]+bestaudio/best[height<=720]',
      '--merge-output-format', 'mp4',
      '-o', videoPath,
      '--no-playlist', '--no-warnings', url,
    ], { maxBuffer: 10 * 1024 * 1024, timeout: 300_000 });
    localPath = videoPath;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn('youtube', 'video download failed', { message: msg.slice(0, 200) });
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }

  return {
    platform: 'youtube',
    author: uploader,
    authorHandle: uploader,
    title: data.title,
    text: buildVideoText(data),
    images: data.thumbnail ? [data.thumbnail] : [],
    videos: [{ url: data.webpage_url, type: 'video' as const, localPath }],
    date: formatDate(data.upload_date),
    url,
    tempDir: localPath ? tmpDir : undefined,
  };
}

async function extractPlaylist(url: string): Promise<ExtractedContent> {
  let stdout: string;
  try {
    const result = await execFileAsync('yt-dlp', [
      '--dump-single-json', '--no-warnings', url,
    ], { maxBuffer: 50 * 1024 * 1024, timeout: 300_000 });
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

  const data = JSON.parse(stdout) as YtDlpPlaylistOutput;
  const uploader = data.channel ?? data.uploader ?? 'Unknown';

  // Download all playlist videos (720p max, mp4)
  const tmpDir = join(tmpdir(), `getthreads-yt-pl-${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });

  const videos: VideoInfo[] = [];
  try {
    await execFileAsync('yt-dlp', [
      '-f', 'bestvideo[height<=720]+bestaudio/best[height<=720]',
      '--merge-output-format', 'mp4',
      '-o', join(tmpDir, '%(playlist_index)s.mp4'),
      '--no-warnings', url,
    ], { maxBuffer: 10 * 1024 * 1024, timeout: 600_000 });

    for (let i = 0; i < data.entries.length; i++) {
      const videoFile = join(tmpDir, `${i + 1}.mp4`);
      try {
        await access(videoFile);
        videos.push({
          url: data.entries[i].webpage_url ?? data.entries[i].url,
          type: 'video' as const,
          localPath: videoFile,
        });
      } catch { /* file not downloaded */ }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn('youtube', 'playlist video download failed', { message: msg.slice(0, 200) });
  }

  return {
    platform: 'youtube',
    author: uploader,
    authorHandle: uploader,
    title: data.title,
    text: buildPlaylistText(data),
    images: [],
    videos,
    date: new Date().toISOString().split('T')[0],
    url,
    tempDir: videos.length > 0 ? tmpDir : undefined,
  };
}

export const youtubeExtractor: Extractor = {
  platform: 'youtube',

  match(url: string): boolean {
    return VIDEO_PATTERN.test(url) || PLAYLIST_PATTERN.test(url);
  },

  parseId(url: string): string | null {
    const videoMatch = url.match(VIDEO_PATTERN);
    if (videoMatch) return videoMatch[1];
    const playlistMatch = url.match(PLAYLIST_PATTERN);
    return playlistMatch?.[1] ?? null;
  },

  async extract(url: string): Promise<ExtractedContent> {
    return isPlaylistUrl(url) ? extractPlaylist(url) : extractVideo(url);
  },
};
