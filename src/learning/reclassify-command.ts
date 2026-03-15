/** Reclassify all Markdown notes in the Vault by comparing stored category to fresh classification. */

import { classifyContent } from '../classifier.js';
import type { AppConfig } from '../utils/config.js';
import { readdir, readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { recordFeedback } from './feedback-tracker.js';

export interface ReclassifyResult {
  total: number;
  moved: number;
  changes: Array<{ file: string; from: string; to: string }>;
}

/** Recursively collect all .md file paths under a directory. */
async function collectMarkdownFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await collectMarkdownFiles(fullPath);
      files.push(...nested);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(fullPath);
    }
  }
  return files;
}

/**
 * Extract the value of a frontmatter field (e.g. "title" or "category").
 * Handles both quoted and unquoted values.
 */
function extractFrontmatterField(content: string, field: string): string | null {
  const re = new RegExp(`^${field}:\\s*"?([^"\\n]+)"?\\s*$`, 'm');
  const match = content.match(re);
  return match ? match[1].trim() : null;
}

/** Replace the value of a frontmatter field in the file content. */
function replaceFrontmatterField(content: string, field: string, newValue: string): string {
  const re = new RegExp(`^(${field}:\\s*).*$`, 'm');
  return content.replace(re, `$1${newValue}`);
}

/**
 * Scan all .md files under {vaultPath}/GetThreads/, reclassify each by title,
 * and move files whose top-level category has changed to the new folder.
 */
export async function executeReclassify(config: AppConfig): Promise<ReclassifyResult> {
  const baseDir = join(config.vaultPath, 'GetThreads');
  const allFiles = await collectMarkdownFiles(baseDir);

  let moved = 0;
  const changes: Array<{ file: string; from: string; to: string }> = [];

  for (const filePath of allFiles) {
    let raw: string;
    try {
      raw = await readFile(filePath, 'utf-8');
    } catch {
      continue;
    }

    const title = extractFrontmatterField(raw, 'title') ?? '';
    const storedCategory = extractFrontmatterField(raw, 'category');
    if (!storedCategory) continue;

    // Reclassify using title only (text passed as empty string)
    const newCategory = classifyContent(title, '');

    const oldTop = storedCategory.split('/')[0];
    const newTop = newCategory.split('/')[0];

    if (oldTop === newTop) continue;

    // Compute the new directory: replace the current top-level folder name with new top
    // e.g. baseDir/AI/工具/foo.md → baseDir/科技/工具/foo.md  (top only matters)
    // Strategy: replace only the first segment after baseDir
    const relativeTail = filePath.slice(baseDir.length).replace(/\\/g, '/');
    // relativeTail = /OldTop/…/file.md  or  /OldTop/file.md
    const segments = relativeTail.split('/').filter(Boolean);
    // Replace first segment (old top-level category dir) with newTop
    segments[0] = newTop;
    const newFilePath = join(baseDir, ...segments);
    const newDir = dirname(newFilePath);

    // Update frontmatter category
    const updatedRaw = replaceFrontmatterField(raw, 'category', newCategory);

    try {
      await mkdir(newDir, { recursive: true });
      await writeFile(filePath, updatedRaw, 'utf-8');
      await rename(filePath, newFilePath);
    } catch {
      continue;
    }

    moved++;
    changes.push({
      file: segments.slice(-1)[0] ?? filePath,
      from: storedCategory,
      to: newCategory,
    });

    // Record feedback for learning loop reinforcement
    const kwField = extractFrontmatterField(raw, 'keywords');
    const keywords = kwField
      ? kwField.replace(/[\[\]"]/g, '').split(',').map(k => k.trim()).filter(Boolean)
      : [];
    recordFeedback({
      from: storedCategory,
      to: newCategory,
      title,
      keywords,
      timestamp: new Date().toISOString(),
    }).catch(() => {});
  }

  return { total: allFiles.length, moved, changes };
}
