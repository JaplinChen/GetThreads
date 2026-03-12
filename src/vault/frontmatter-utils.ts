/**
 * Shared frontmatter parsing utilities.
 * Extracted from vault-learner.ts for reuse across vault modules.
 */
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

/** Folders to skip when scanning vault notes */
const SKIP_FOLDERS = new Set(['MOC', 'attachments', '知識整合', '.obsidian', '.trash']);

/** Parse YAML frontmatter from raw markdown into a key-value map */
export function parseFrontmatter(raw: string): Map<string, string> {
  const lines = raw.split('\n');
  if (lines[0]?.trim() !== '---') return new Map();

  let endIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      endIdx = i;
      break;
    }
  }
  if (endIdx === -1) return new Map();

  const fields = new Map<string, string>();
  for (const line of lines.slice(1, endIdx)) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    fields.set(line.slice(0, colonIdx).trim(), line.slice(colonIdx + 1).trim());
  }
  return fields;
}

/** Parse a frontmatter array field like `keywords: [a, b, c]` */
export function parseArrayField(val: string): string[] {
  const match = val.match(/\[(.+)\]/);
  if (!match) return [];

  return match[1]
    .split(',')
    .map((s) => s.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean);
}

/** Recursively find all .md files in a directory, skipping system folders */
export async function getAllMdFiles(dir: string, skip = SKIP_FOLDERS): Promise<string[]> {
  const files: string[] = [];
  try {
    for (const entry of await readdir(dir)) {
      if (skip.has(entry)) continue;
      const full = join(dir, entry);
      if ((await stat(full)).isDirectory()) {
        files.push(...await getAllMdFiles(full, skip));
      } else if (entry.endsWith('.md')) {
        files.push(full);
      }
    }
  } catch {
    // Skip unreadable dirs
  }
  return files;
}
