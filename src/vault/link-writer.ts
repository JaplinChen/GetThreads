/**
 * Write link suggestions to vault notes and generate an index note.
 * Uses HTML comment markers for idempotent updates.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { logger } from '../core/logger.js';
import type { LinkSuggestion } from './link-suggester.js';
import { noteBasename } from './link-suggester.js';

const MARKER_START = '<!-- related-notes-start -->';
const MARKER_END = '<!-- related-notes-end -->';

/** Format suggestions as a markdown section */
function formatSection(suggestions: LinkSuggestion[]): string {
  const lines = [
    '',
    MARKER_START,
    '## 相關筆記',
    '',
  ];

  for (const s of suggestions) {
    const name = noteBasename(s.filePath);
    const shared = s.sharedKeywords.slice(0, 3).join(', ');
    lines.push(`- [[${name}]]（共同：${shared}）`);
  }

  lines.push(MARKER_END);
  return lines.join('\n');
}

/** Write suggestions to the bottom of a single note (idempotent) */
export async function writeSuggestionsToNote(
  filePath: string, suggestions: LinkSuggestion[],
): Promise<boolean> {
  if (suggestions.length === 0) return false;

  try {
    let content = await readFile(filePath, 'utf-8');
    const section = formatSection(suggestions);

    const startIdx = content.indexOf(MARKER_START);
    const endIdx = content.indexOf(MARKER_END);

    if (startIdx >= 0 && endIdx >= 0) {
      // Replace existing section
      content = content.slice(0, startIdx) + section.trimStart() + content.slice(endIdx + MARKER_END.length);
    } else {
      // Append to end
      content = content.trimEnd() + '\n' + section + '\n';
    }

    await writeFile(filePath, content, 'utf-8');
    return true;
  } catch (err) {
    logger.warn('suggest', '寫入失敗', { file: basename(filePath), err: (err as Error).message });
    return false;
  }
}

/** Generate an index note listing all notes with their top related suggestions */
export async function writeIndexNote(
  vaultPath: string, allSuggestions: Map<string, LinkSuggestion[]>,
): Promise<string> {
  const outPath = join(vaultPath, 'GetThreads', '相關筆記索引.md');
  const now = new Date().toISOString().slice(0, 10);

  const lines: string[] = [];
  lines.push('---');
  lines.push('title: 相關筆記索引');
  lines.push(`date: ${now}`);
  lines.push('tags: [knowledge, auto-generated, related-notes]');
  lines.push('---');
  lines.push('', '# 相關筆記索引', '');
  lines.push(`> 自動產生於 ${now}，涵蓋 ${allSuggestions.size} 篇有推薦的筆記。`, '');

  // Group by category extracted from file path
  const byCategory = new Map<string, Array<{ note: string; suggestions: LinkSuggestion[] }>>();

  for (const [filePath, suggestions] of allSuggestions) {
    // Extract category from path: .../GetThreads/Category/SubCategory/note.md
    const rel = filePath.split('GetThreads')[1] ?? '';
    const parts = rel.replace(/\\/g, '/').split('/').filter(Boolean);
    const category = parts.length >= 2 ? parts.slice(0, -1).join('/') : '其他';
    const name = noteBasename(filePath);

    if (!byCategory.has(category)) byCategory.set(category, []);
    byCategory.get(category)!.push({ note: name, suggestions });
  }

  // Sort categories by note count desc
  const sorted = [...byCategory.entries()].sort((a, b) => b[1].length - a[1].length);

  for (const [category, entries] of sorted) {
    lines.push(`## ${category}（${entries.length} 篇）`, '');
    for (const { note, suggestions } of entries.slice(0, 50)) {
      const top3 = suggestions.slice(0, 3);
      const links = top3.map(s => `[[${noteBasename(s.filePath)}]]`).join(', ');
      lines.push(`- **[[${note}]]** → ${links}`);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push(`*自動產生 by GetThreads /suggest — ${new Date().toISOString().slice(0, 19)}*`);

  const content = lines.join('\n');
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, content, 'utf-8');

  logger.info('suggest', '索引已生成', { path: outPath, entries: allSuggestions.size });
  return outPath;
}
