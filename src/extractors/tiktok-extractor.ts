/** TikTok extractor — video (yt-dlp + ffmpeg + whisper) & photo slideshow (Camoufox). */
import { execFile } from 'node:child_process';
import { logger } from '../core/logger.js';
import { promisify } from 'node:util';
import { access, mkdir, readFile, rename, rm, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { ExtractedContent, Extractor } from './types.js';
import { camoufoxPool } from '../utils/camoufox-pool.js';

const execFileAsync = promisify(execFile);

const TIKTOK_POST = /tiktok\.com\/@[\w.]+\/(?:video|photo)\/(\d+)/i;
const TIKTOK_SHORT_VT = /vt\.tiktok\.com\/([\w]+)/i;
const TIKTOK_SHORT_VM = /vm\.tiktok\.com\/([\w]+)/i;
const TIKTOK_CACHE_DIR = join(process.cwd(), 'data', 'cache', 'tiktok');

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
  formats?: Array<{ format_id?: string; ext?: string; vcodec?: string }>;
}

/** Resolve short TikTok URLs (vt/vm.tiktok.com) to full URLs via redirect */
async function resolveShortUrl(url: string): Promise<string> {
  if (TIKTOK_POST.test(url)) return url;
  try {
    const resolved = (await fetch(url, { method: 'HEAD', redirect: 'follow' })).url;
    if (/tiktok\.com/.test(resolved)) return resolved;
  } catch { /* fallback to original */ }
  return url;
}

function formatDate(uploadDate?: string): string {
  if (!uploadDate || uploadDate.length !== 8) return new Date().toISOString().split('T')[0];
  return `${uploadDate.slice(0, 4)}-${uploadDate.slice(4, 6)}-${uploadDate.slice(6, 8)}`;
}

async function fileExists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

async function isUsableFile(path: string): Promise<boolean> {
  try { const st = await stat(path); return st.isFile() && st.size > 0; } catch { return false; }
}

/** Parse WebVTT subtitle file into plain text (deduplicated lines) */
function parseVTT(vtt: string): string {
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const line of vtt.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed === 'WEBVTT' || /^\d{2}:/.test(trimmed) || /^NOTE/.test(trimmed)) continue;
    if (!seen.has(trimmed)) { seen.add(trimmed); lines.push(trimmed); }
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
  return entries.filter(f => f.startsWith('frame-') && f.endsWith('.jpg')).sort().map(f => join(outputDir, f));
}

/** Try whisper.cpp STT fallback for videos without subtitles */
async function whisperTranscribe(videoPath: string, tmpDir: string): Promise<string | null> {
  const audioPath = join(tmpDir, 'audio.wav');
  try {
    await execFileAsync('ffmpeg', [
      '-y', '-i', videoPath, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', audioPath,
    ], { timeout: 30_000 });
  } catch { logger.warn('tiktok', 'ffmpeg audio extraction failed'); return null; }

  const localWhisper = join(process.cwd(), 'tools', 'whisper', 'Release', 'whisper-cli.exe');
  for (const cmd of [localWhisper, 'whisper-cli', 'whisper']) {
    try {
      const { stdout } = await execFileAsync(cmd, [
        '-m', join(process.cwd(), 'models', 'ggml-small.bin'),
        '-l', 'zh', '--no-timestamps', '-f', audioPath,
      ], { timeout: 120_000, maxBuffer: 5 * 1024 * 1024 });
      if (stdout.trim()) return stdout.trim();
    } catch { continue; }
  }
  logger.warn('tiktok', 'whisper.cpp not available; skipping STT');
  return null;
}

/** Get transcript: prefer platform subtitles, fallback to whisper.cpp */
async function getTranscript(
  meta: TikTokMeta, tmpDir: string, videoPath: string,
): Promise<string | null> {
  const subFiles = (await readdir(tmpDir).catch(() => [])).filter(f => f.endsWith('.vtt'));
  if (subFiles.length > 0) {
    const preferred = subFiles.find(f => /cmn|zh|chi/i.test(f))
      ?? subFiles.find(f => /eng/i.test(f)) ?? subFiles[0];
    const text = parseVTT(await readFile(join(tmpDir, preferred), 'utf-8'));
    if (text.length > 10) return text;
  }
  return whisperTranscribe(videoPath, tmpDir);
}

/** Build clean display text from metadata */
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
    lines.push(meta.description.length > 1000 ? meta.description.slice(0, 1000) + '...' : meta.description);
  }
  return lines.join('\n');
}

/** Detect slideshow: formats contain only audio (no video codec) */
function isSlideshow(meta: TikTokMeta): boolean {
  if (!meta.formats || meta.formats.length === 0) return true;
  return meta.formats.every(f => f.vcodec === 'none' || f.ext === 'm4a');
}

/** Extract slide images from TikTok page via Camoufox browser rendering */
async function extractSlideImages(pageUrl: string): Promise<string[]> {
  const { page, release } = await camoufoxPool.acquire();
  try {
    await page.goto(pageUrl, { waitUntil: 'networkidle', timeout: 30_000 });
    await page.waitForTimeout(2000);
    const imgEls = await page.locator(
      '[data-e2e="photo-detail-carousel"] img, .swiper-slide img, .photo-detail img, [class*="DivPhotoContainer"] img',
    ).all();
    const urls: string[] = [];
    for (const el of imgEls) {
      const src = await el.getAttribute('src').catch(() => null);
      if (src && !src.startsWith('data:') && !src.includes('100x100')) urls.push(src);
    }
    return [...new Set(urls)];
  } catch (err) {
    logger.warn('tiktok', 'Camoufox slide extraction failed', { message: (err as Error).message });
    return [];
  } finally {
    await release();
  }
}

/** Download video and optionally transcode H.265→H.264, saving to cache */
async function downloadAndCacheVideo(
  url: string, tmpDir: string, downloadPath: string, cacheVideoPath: string,
): Promise<void> {
  await execFileAsync('yt-dlp', [
    '-f', 'best[ext=mp4]/best', '--write-subs', '--all-subs', '--sub-format', 'vtt',
    '-o', downloadPath, '--no-playlist', '--encoding', 'utf-8', '--no-warnings', url,
  ], { maxBuffer: 10 * 1024 * 1024, timeout: 120_000 });

  const h264Path = join(tmpDir, 'video-h264.mp4');
  try {
    const { stdout: probeOut } = await execFileAsync('ffprobe', [
      '-v', 'quiet', '-select_streams', 'v:0',
      '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', downloadPath,
    ], { timeout: 10_000 });
    if (probeOut.trim() === 'hevc' || probeOut.trim() === 'h265') {
      logger.info('tiktok', 'Transcoding H.265 -> H.264');
      await execFileAsync('ffmpeg', [
        '-y', '-i', downloadPath, '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
        '-c:a', 'aac', '-movflags', '+faststart', h264Path,
      ], { timeout: 120_000 });
      await rm(downloadPath, { force: true });
      await rename(h264Path, downloadPath);
    }
  } catch (err) {
    logger.warn('tiktok', 'H.264 transcode failed; keeping original', { message: (err as Error).message });
    await rm(h264Path, { force: true }).catch(() => {});
  }
  await rename(downloadPath, cacheVideoPath);
}

export const tiktokExtractor: Extractor = {
  platform: 'tiktok',

  match(url: string): boolean {
    return TIKTOK_POST.test(url) || TIKTOK_SHORT_VT.test(url) || TIKTOK_SHORT_VM.test(url);
  },

  parseId(url: string): string | null {
    return (
      url.match(TIKTOK_POST)?.[1]
      ?? url.match(TIKTOK_SHORT_VT)?.[1]
      ?? url.match(TIKTOK_SHORT_VM)?.[1]
      ?? null
    );
  },

  async extract(url: string): Promise<ExtractedContent> {
    // Resolve short URLs first, then swap /photo/ → /video/ for yt-dlp
    const resolvedUrl = await resolveShortUrl(url);
    const metaUrl = resolvedUrl.replace(/\/photo\//, '/video/');

    let meta: TikTokMeta;
    try {
      const { stdout } = await execFileAsync('yt-dlp', [
        '--dump-json', '--encoding', 'utf-8', '--no-playlist', '--no-warnings', metaUrl,
      ], { maxBuffer: 10 * 1024 * 1024, timeout: 30_000 });
      meta = JSON.parse(stdout);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('ENOENT')) throw new Error('yt-dlp is not installed');
      throw new Error(`TikTok metadata failed: ${msg.slice(0, 200)}`);
    }

    const author = meta.creator ?? meta.uploader ?? 'Unknown';
    const pageUrl = meta.webpage_url ?? resolvedUrl;

    // ── Slideshow: Camoufox for images, no video download ──
    if (isSlideshow(meta)) {
      logger.info('tiktok', `slideshow detected, fetching images via Camoufox`, { id: meta.id });
      const slideImages = await extractSlideImages(pageUrl.replace(/\/video\//, '/photo/'));
      const images = slideImages.length > 0
        ? slideImages
        : meta.thumbnail ? [meta.thumbnail] : [];
      return {
        platform: 'tiktok', author, authorHandle: `@${author}`,
        title: meta.title || meta.description?.split('\n')[0]?.slice(0, 80) || 'TikTok Photos',
        text: buildText(meta), images, videos: [],
        date: formatDate(meta.upload_date),
        url: pageUrl.replace(/\/video\//, '/photo/'),
        likes: meta.like_count, reposts: meta.repost_count,
      };
    }

    // ── Video: existing yt-dlp download pipeline ──
    const tmpDir = join(tmpdir(), `getthreads-tiktok-${meta.id}`);
    await mkdir(tmpDir, { recursive: true });
    await mkdir(TIKTOK_CACHE_DIR, { recursive: true });
    const cacheVideoPath = join(TIKTOK_CACHE_DIR, `${meta.id}.mp4`);
    const cacheTranscriptPath = join(TIKTOK_CACHE_DIR, `${meta.id}.transcript.txt`);

    try {
      const cacheHit = await isUsableFile(cacheVideoPath);
      if (!cacheHit) {
        await downloadAndCacheVideo(url, tmpDir, join(tmpDir, 'video.mp4'), cacheVideoPath);
      } else {
        logger.info('tiktok', `cache hit for ${meta.id}`);
      }

      let transcript: string | null = null;
      if (await fileExists(cacheTranscriptPath)) {
        transcript = (await readFile(cacheTranscriptPath, 'utf-8')).trim() || null;
      } else {
        transcript = await getTranscript(meta, tmpDir, cacheVideoPath);
        if (transcript) await writeFile(cacheTranscriptPath, transcript, 'utf-8').catch(() => {});
      }

      await rm(join(tmpDir, 'audio.wav'), { force: true }).catch(() => {});

      return {
        platform: 'tiktok', author, authorHandle: `@${author}`,
        title: meta.title || meta.description?.split('\n')[0]?.slice(0, 80) || 'TikTok Video',
        text: buildText(meta),
        images: meta.thumbnail ? [meta.thumbnail] : [],
        videos: [{ url: pageUrl, type: 'video' as const, localPath: cacheVideoPath }],
        date: formatDate(meta.upload_date), url: pageUrl,
        likes: meta.like_count, reposts: meta.repost_count,
        transcript: transcript ?? undefined, tempDir: tmpDir,
      };
    } catch (err) {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      throw err;
    }
  },
};
