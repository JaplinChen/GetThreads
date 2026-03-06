import { mkdir, writeFile, readdir, readFile } from 'node:fs/promises';
import { join, extname, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import type { ExtractedContent, Platform } from './extractors/types.js';
import { formatAsMarkdown } from './formatter.js';
import { fetchWithTimeout } from './utils/fetch-with-timeout.js';

/** Extract a short, stable ID from a URL for use in filenames */
function extractPostId(url: string, platform: Platform): string {
  try {
    const u = new URL(url);
    switch (platform) {
      case 'x':
        return u.pathname.match(/\/status\/(\d+)/)?.[1] ?? 'unknown';
      case 'threads':
        return u.pathname.match(/\/post\/([\w-]+)/)?.[1] ?? 'unknown';
      case 'youtube':
        return u.searchParams.get('v') ?? u.pathname.split('/').filter(Boolean).pop() ?? 'unknown';
      case 'github':
        return u.pathname.split('/').filter(Boolean).slice(0, 3).join('-').slice(0, 40);
      case 'reddit':
        return u.pathname.split('/').filter(Boolean)[3] ?? 'unknown';
      default:
        return createHash('md5').update(url).digest('hex').slice(0, 8);
    }
  } catch {
    return 'unknown';
  }
}

/** Convert a title string into a safe, readable filename slug */
function slugify(text: string, maxLen = 50): string {
  return text
    .replace(/[\\/:*?"<>|]/g, '')  // Remove Windows-invalid chars
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen)
    .trim();
}

/** Download a single image and return the local file path (relative to vault) */
async function downloadImage(
  imageUrl: string,
  destDir: string,
  filename: string,
): Promise<string> {
  const res = await fetchWithTimeout(imageUrl, 30_000);
  if (!res.ok) {
    throw new Error(`Failed to download image: ${res.status} ${imageUrl}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());

  const ext = extname(new URL(imageUrl).pathname) || '.jpg';
  const fullName = `${filename}${ext}`;
  const fullPath = join(destDir, fullName);
  await writeFile(fullPath, buffer);

  // Return Obsidian-relative path
  return `attachments/getthreads/${fullName}`;
}

export interface SaveResult {
  mdPath: string;
  imageCount: number;
  videoCount: number;
  duplicate?: boolean;
}

/** Normalise a URL for dedup comparison: strip query string, keep only origin + pathname */
function normaliseUrl(raw: string): string {
  try {
    const u = new URL(raw);
    return u.origin + u.pathname.replace(/\/+$/, '');
  } catch {
    return raw;
  }
}

/**
 * Scan all .md files under {vaultPath}/GetThreads/ and check whether any of
 * them already contains a matching `url:` front-matter field.
 * Returns the existing file path on a match, otherwise null.
 */
async function isDuplicateUrl(url: string, vaultPath: string): Promise<string | null> {
  const targetNorm = normaliseUrl(url);
  const rootDir = join(vaultPath, 'GetThreads');

  async function scanDir(dir: string): Promise<string | null> {
    let entries: import('node:fs').Dirent<string>[];
    try {
      entries = await readdir(dir, { withFileTypes: true, encoding: 'utf-8' });
    } catch {
      return null;
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        const found = await scanDir(fullPath);
        if (found) return found;
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        try {
          const raw = await readFile(fullPath, 'utf-8');
          const first25 = raw.split('\n').slice(0, 25).join('\n');
          const match = first25.match(/^url:\s*["']?(.*?)["']?\s*$/m);
          if (match) {
            const fileNorm = normaliseUrl(match[1].trim());
            if (fileNorm === targetNorm) return fullPath;
          }
        } catch {
          // skip unreadable files
        }
      }
    }
    return null;
  }

  return scanDir(rootDir);
}

/** Save extracted content as Obsidian Markdown + images to the vault */
export async function saveToVault(
  content: ExtractedContent,
  vaultPath: string,
  opts?: { forceOverwrite?: boolean },
): Promise<SaveResult> {
  // Dedup check before any disk I/O (skipped when forceOverwrite, e.g. /comments)
  if (!opts?.forceOverwrite) {
    const existingPath = await isDuplicateUrl(content.url, vaultPath);
    if (existingPath) {
      return { mdPath: existingPath, imageCount: 0, videoCount: 0, duplicate: true };
    }
  }

  const postId = extractPostId(content.url, content.platform);

  // Ensure directories exist
  const rawCategory = content.category ?? '其他';
  // Sanitize: allow only CJK/alphanumeric/dash/underscore/space, max 2 levels
  const categoryParts = rawCategory
    .split('/')
    .slice(0, 2)
    .map(p => p.replace(/[^a-zA-Z0-9\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\-_ ]/g, '').trim())
    .filter(p => p.length > 0);
  const folderPath = categoryParts.join('/') || '其他';
  // Defense in depth: verify resolved path stays within vault
  const baseGetThreads = resolve(join(vaultPath, 'GetThreads'));
  const resolvedNotes = resolve(join(vaultPath, 'GetThreads', folderPath));
  const notesDir = (resolvedNotes === baseGetThreads || resolvedNotes.startsWith(baseGetThreads + sep))
    ? resolvedNotes
    : baseGetThreads;
  const imagesDir = join(vaultPath, 'attachments', 'getthreads');
  await mkdir(notesDir, { recursive: true });
  await mkdir(imagesDir, { recursive: true });

  // Download all images
  const localImagePaths: string[] = [];
  for (let i = 0; i < content.images.length; i++) {
    const imgFilename = `${content.platform}-${postId}-${i}`;
    const relativePath = await downloadImage(
      content.images[i],
      imagesDir,
      imgFilename,
    );
    localImagePaths.push(relativePath);
  }

  // Download video thumbnails
  for (let i = 0; i < content.videos.length; i++) {
    const thumb = content.videos[i].thumbnailUrl;
    if (thumb) {
      try {
        const thumbFilename = `${content.platform}-${postId}-vid${i}-thumb`;
        const relativePath = await downloadImage(thumb, imagesDir, thumbFilename);
        localImagePaths.push(relativePath);
      } catch {
        // skip failed thumbnail downloads
      }
    }
  }

  // Generate Markdown
  const markdown = formatAsMarkdown(content, localImagePaths);

  // Save .md file with readable name
  // Fallback: if title looks like an error message, use hostname instead
  const ERROR_TITLE_RE = /^(warning[:\s]|error\s*\d{3}|access denied|forbidden|you've been blocked)/i;
  let titleForFilename = content.title;
  if (ERROR_TITLE_RE.test(titleForFilename)) {
    try {
      titleForFilename = new URL(content.url).hostname.replace(/^www\./, '');
    } catch {
      titleForFilename = 'untitled';
    }
  }
  const slug = slugify(titleForFilename);
  const mdFilename = `${content.date}-${content.platform}-${slug}.md`;
  const mdPath = join(notesDir, mdFilename);
  await writeFile(mdPath, markdown, 'utf-8');

  return { mdPath, imageCount: localImagePaths.length, videoCount: content.videos.length };
}
