/**
 * TikTok extractor — uses yt-dlp for video/metadata/subtitles,
 * ffmpeg for keyframe screenshots, whisper.cpp as STT fallback.
 */
import { execFile } from 'node:child_process';
import { logger } from '../core/logger.js';
import { promisify } from 'node:util';
import { mkdir, readFile, rm, readdir } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { tmpdir } from 'node:os';
import type { ExtractedContent, Extractor } from './types.js';

const execFileAsync = promisify(execFile);

const TIKTOK_VIDEO = /tiktok\.com\/@[\w.]+\/video\/(\d+)/i;
const TIKTOK_SHORT_VT = /vt\.tiktok\.com\/([\w]+)/i;
const TIKTOK_SHORT_VM = /vm\.tiktok\.com\/([\w]+)/i;

interface TikTokMeta {
  id: string;
  title: string;
  description?: string;
  uploader?: string;
  creator?: string;
  upload_date?: string;
  thumbnail?: string;
  duration?: number;
  view_count?: number;
  like_count?: number;
  comment_count?: number;
  repost_count?: number;
  subtitles?: Record<string, Array<{ ext: string; url: string }>>;
  webpage_url: string;
}

function formatDate(uploadDate?: string): string {
  if (!uploadDate || uploadDate.length !== 8) return new Date().toISOString().split('T')[0];
  return `${uploadDate.slice(0, 4)}-${uploadDate.slice(4, 6)}-${uploadDate.slice(6, 8)}`;
}

/** Parse WebVTT subtitle file into plain text (deduplicated lines) */
function parseVTT(vtt: string): string {
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const line of vtt.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed === 'WEBVTT' || /^\d{2}:/.test(trimmed) || /^NOTE/.test(trimmed)) continue;
    if (!seen.has(trimmed)) {
      seen.add(trimmed);
      lines.push(trimmed);
    }
  }
  return lines.join('\n');
}

/** Extract keyframe screenshots from video using ffmpeg */
async function extractFrames(
  videoPath: string, outputDir: string, duration: number,
): Promise<string[]> {
  const count = duration <= 15 ? 2 : duration <= 60 ? 3 : 5;
  const interval = duration / (count + 1);
  const args: string[] = ['-y', '-i', videoPath];
  for (let i = 1; i <= count; i++) {
    const t = Math.min(Math.floor(interval * i), Math.max(duration - 1, 0));
    args.push('-ss', String(t), '-frames:v', '1', join(outputDir, `frame-${i - 1}.jpg`));
  }
  await execFileAsync('ffmpeg', args, { timeout: 30_000 });

  const entries = await readdir(outputDir);
  return entries
    .filter(f => f.startsWith('frame-') && f.endsWith('.jpg'))
    .sort()
    .map(f => join(outputDir, f));
}

/** Try whisper.cpp STT fallback for videos without subtitles */
async function whisperTranscribe(videoPath: string, tmpDir: string): Promise<string | null> {
  const audioPath = join(tmpDir, 'audio.wav');
  try {
    // Extract 16kHz mono WAV (whisper.cpp requirement)
    await execFileAsync('ffmpeg', [
      '-y', '-i', videoPath, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', audioPath,
    ], { timeout: 30_000 });
  } catch {
    logger.warn('tiktok', 'ffmpeg audio extraction failed');
    return null;
  }

  // Try whisper-cli (whisper.cpp) — local binary first, then PATH
  const localWhisper = join(process.cwd(), 'tools', 'whisper', 'Release', 'whisper-cli.exe');
  for (const cmd of [localWhisper, 'whisper-cli', 'whisper']) {
    try {
      const { stdout } = await execFileAsync(cmd, [
        '-m', join(process.cwd(), 'models', 'ggml-small.bin'),
        '-l', 'zh',
        '--no-timestamps',
        '-f', audioPath,
      ], { timeout: 120_000, maxBuffer: 5 * 1024 * 1024 });
      if (stdout.trim()) return stdout.trim();
    } catch {
      continue;
    }
  }
  logger.warn('tiktok', 'whisper.cpp not available; skipping STT');
  return null;
}

/** Get transcript: prefer platform subtitles, fallback to whisper.cpp */
async function getTranscript(
  meta: TikTokMeta, tmpDir: string, videoPath: string,
): Promise<string | null> {
  // 1. Try platform subtitles (prefer Chinese, then English, then any)
  const subFiles = (await readdir(tmpDir).catch(() => []))
    .filter(f => f.endsWith('.vtt'));

  if (subFiles.length > 0) {
    const preferred = subFiles.find(f => /cmn|zh|chi/i.test(f))
      ?? subFiles.find(f => /eng/i.test(f))
      ?? subFiles[0];
    const vtt = await readFile(join(tmpDir, preferred), 'utf-8');
    const text = parseVTT(vtt);
    if (text.length > 10) return text;
  }

  // 2. Whisper.cpp fallback
  return whisperTranscribe(videoPath, tmpDir);
}

/** Build clean display text from metadata (no transcript — that goes to AI enricher) */
function buildText(meta: TikTokMeta): string {
  const lines: string[] = [];
  if (meta.duration) {
    const m = Math.floor(meta.duration / 60);
    const s = meta.duration % 60;
    lines.push(`**Duration:** ${m}:${String(s).padStart(2, '0')}`);
  }
  const stats: string[] = [];
  if (meta.view_count != null) stats.push(`Views: ${meta.view_count.toLocaleString()}`);
  if (meta.like_count != null) stats.push(`Likes: ${meta.like_count.toLocaleString()}`);
  if (meta.comment_count != null) stats.push(`Comments: ${meta.comment_count.toLocaleString()}`);
  if (stats.length > 0) lines.push(`**Stats:** ${stats.join(' | ')}`);

  if (meta.description) {
    if (lines.length > 0) lines.push('');
    const desc = meta.description.length > 1000
      ? meta.description.slice(0, 1000) + '...'
      : meta.description;
    lines.push(desc);
  }

  return lines.join('\n');
}

export const tiktokExtractor: Extractor = {
  platform: 'tiktok',

  match(url: string): boolean {
    return TIKTOK_VIDEO.test(url) || TIKTOK_SHORT_VT.test(url) || TIKTOK_SHORT_VM.test(url);
  },

  parseId(url: string): string | null {
    return (
      url.match(TIKTOK_VIDEO)?.[1]
      ?? url.match(TIKTOK_SHORT_VT)?.[1]
      ?? url.match(TIKTOK_SHORT_VM)?.[1]
      ?? null
    );
  },

  async extract(url: string): Promise<ExtractedContent> {
    // 1. Get metadata via yt-dlp
    let meta: TikTokMeta;
    try {
      const { stdout } = await execFileAsync('yt-dlp', [
        '--dump-json', '--no-playlist', '--no-warnings', url,
      ], { maxBuffer: 10 * 1024 * 1024, timeout: 30_000 });
      meta = JSON.parse(stdout);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('ENOENT')) throw new Error('yt-dlp is not installed');
      throw new Error(`TikTok metadata failed: ${msg.slice(0, 200)}`);
    }

    // 2. Prepare temp directory
    const tmpDir = join(tmpdir(), `getthreads-tiktok-${meta.id}`);
    await mkdir(tmpDir, { recursive: true });
    const videoPath = join(tmpDir, 'video.mp4');

    try {
      // 3. Download video + subtitles
      await execFileAsync('yt-dlp', [
        '-f', 'best[ext=mp4]/best',
        '--write-subs', '--all-subs', '--sub-format', 'vtt',
        '-o', videoPath,
        '--no-playlist', '--no-warnings', url,
      ], { maxBuffer: 10 * 1024 * 1024, timeout: 120_000 });

      // 3b. Transcode H.265→H.264 if needed (Obsidian/Chromium can't play HEVC)
      const h264Path = join(tmpDir, 'video-h264.mp4');
      try {
        const { stdout: probeOut } = await execFileAsync('ffprobe', [
          '-v', 'quiet', '-select_streams', 'v:0',
          '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', videoPath,
        ], { timeout: 10_000 });
        if (probeOut.trim() === 'hevc' || probeOut.trim() === 'h265') {
          logger.info('tiktok', 'Transcoding H.265 -> H.264');
          await execFileAsync('ffmpeg', [
            '-y', '-i', videoPath,
            '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
            '-c:a', 'aac', '-movflags', '+faststart', h264Path,
          ], { timeout: 120_000 });
          await rm(videoPath, { force: true });
          const { rename } = await import('node:fs/promises');
          await rename(h264Path, videoPath);
        }
      } catch (err) {
        logger.warn('tiktok', 'H.264 transcode failed; keeping original', { message: (err as Error).message });
        await rm(h264Path, { force: true }).catch(() => {});
      }

      // 4. Get transcript
      const transcript = await getTranscript(meta, tmpDir, videoPath);

      // 5. Clean up temp files (keep video for vault saving)
      await rm(join(tmpDir, 'audio.wav'), { force: true }).catch(() => {});

      const author = meta.creator ?? meta.uploader ?? 'Unknown';

      return {
        platform: 'tiktok',
        author,
        authorHandle: `@${author}`,
        title: meta.title || meta.description?.split('\n')[0]?.slice(0, 80) || 'TikTok Video',
        text: buildText(meta),
        images: meta.thumbnail ? [meta.thumbnail] : [],
        videos: [{ url: meta.webpage_url ?? url, type: 'video' as const, localPath: videoPath }],
        date: formatDate(meta.upload_date),
        url: meta.webpage_url ?? url,
        likes: meta.like_count,
        reposts: meta.repost_count,
        transcript: transcript ?? undefined,
        tempDir: tmpDir,
      };
    } catch (err) {
      // Cleanup on error
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      throw err;
    }
  },
};
