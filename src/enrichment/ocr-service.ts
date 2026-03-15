/**
 * OCR service — extract text from images using Tesseract.js.
 * Particularly useful for screenshots containing code or text.
 * Falls back gracefully if tesseract.js is not installed.
 */
import { writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { logger } from '../core/logger.js';
import { fetchWithTimeout } from '../utils/fetch-with-timeout.js';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB
const OCR_TIMEOUT_MS = 30_000;

/** Minimal Tesseract interface for lazy loading */
interface TesseractLike {
  recognize(image: string, lang: string): Promise<{ data: { text: string } }>;
}

/** Lazy-loaded Tesseract to avoid crash if not installed */
let tesseractModule: TesseractLike | null | 'unavailable' = null;

async function getTesseract(): Promise<TesseractLike | null> {
  if (tesseractModule === 'unavailable') return null;
  if (tesseractModule) return tesseractModule;

  try {
    // Dynamic import — won't break compile if tesseract.js is not installed
    const mod = await (Function('return import("tesseract.js")')() as Promise<TesseractLike>);
    tesseractModule = mod;
    return tesseractModule;
  } catch {
    logger.warn('ocr', 'tesseract.js 未安裝，OCR 功能停用');
    tesseractModule = 'unavailable';
    return null;
  }
}

/** Check if image likely contains text (simple heuristic based on image URL patterns) */
export function isLikelyScreenshot(url: string, text: string): boolean {
  const urlLower = url.toLowerCase();
  // Common screenshot patterns
  if (urlLower.includes('screenshot') || urlLower.includes('screen_shot')) return true;
  if (urlLower.includes('capture') || urlLower.includes('snip')) return true;

  // Short text + image suggests the image IS the content
  if (text.length < 100) return true;

  return false;
}

/** Extract text from a single image URL via OCR */
export async function extractTextFromImage(
  imageUrl: string,
  languages: string = 'eng+chi_tra',
): Promise<string | null> {
  const tesseract = await getTesseract();
  if (!tesseract) return null;

  const id = randomBytes(4).toString('hex');
  const tempDir = join(tmpdir(), `getthreads-ocr-${id}`);
  await mkdir(tempDir, { recursive: true });

  try {
    // Download image
    const res = await fetchWithTimeout(imageUrl, 15_000);
    if (!res.ok) return null;

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_IMAGE_BYTES) return null;

    const ext = imageUrl.match(/\.(jpe?g|png|gif|webp|bmp)/i)?.[0] ?? '.png';
    const imgPath = join(tempDir, `ocr-input${ext}`);
    await writeFile(imgPath, buf);

    // OCR with timeout
    const result = await Promise.race([
      tesseract.recognize(imgPath, languages),
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), OCR_TIMEOUT_MS)),
    ]);

    if (result === 'timeout') {
      logger.warn('ocr', 'OCR 超時');
      return null;
    }

    const text = (result as { data: { text: string } }).data.text.trim();

    // Filter out noise: if text is too short or mostly garbage
    if (text.length < 10) return null;
    const alphaRatio = (text.match(/[\w\u4e00-\u9fff]/g)?.length ?? 0) / text.length;
    if (alphaRatio < 0.3) return null; // Too much noise

    logger.info('ocr', '文字辨識完成', { chars: text.length, url: imageUrl.slice(0, 80) });
    return text;
  } catch (err) {
    logger.warn('ocr', 'OCR 失敗', { message: (err as Error).message });
    return null;
  } finally {
    rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Run OCR on multiple images, return combined extracted text.
 * Only processes images likely to contain text (screenshots, code images).
 */
export async function ocrContentImages(
  imageUrls: string[],
  contentText: string,
  maxImages: number = 2,
): Promise<string> {
  const tesseract = await getTesseract();
  if (!tesseract) return '';

  const results: string[] = [];
  const candidates = imageUrls.slice(0, maxImages);

  for (const url of candidates) {
    const text = await extractTextFromImage(url);
    if (text) {
      results.push(text);
    }
  }

  return results.join('\n---\n');
}
