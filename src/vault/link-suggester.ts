/**
 * Link suggestion engine — finds related notes using two-layer fallback:
 * 1. Entity-based (VaultKnowledge, if available)
 * 2. Keyword/category matching (frontmatter, always available)
 */
import { readFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { logger } from '../core/logger.js';
import { parseFrontmatter, parseArrayField, getAllMdFiles } from './frontmatter-utils.js';
import { findRelatedNotes } from '../knowledge/knowledge-graph.js';
import { KNOWLEDGE_PATH } from '../knowledge/knowledge-store.js';
import type { VaultKnowledge } from '../knowledge/types.js';

export interface LinkSuggestion {
  noteId: string;
  filePath: string;
  title: string;
  sharedKeywords: string[];
  score: number;
  method: 'entity' | 'keyword';
}

export interface SuggestOptions {
  limit?: number;
  minScore?: number;
}

/** Lightweight note info parsed from frontmatter only */
interface NoteInfo {
  filePath: string;
  url: string;
  title: string;
  category: string;
  keywords: string[];
  author: string;
}

/** Load all note metadata from vault frontmatter */
export async function loadNoteIndex(vaultPath: string): Promise<NoteInfo[]> {
  const root = join(vaultPath, 'GetThreads');
  const files = await getAllMdFiles(root);
  const notes: NoteInfo[] = [];

  for (const f of files) {
    try {
      const raw = await readFile(f, 'utf-8');
      const fm = parseFrontmatter(raw);
      const url = fm.get('url')?.replace(/^["']|["']$/g, '') ?? '';
      if (!url) continue;

      notes.push({
        filePath: f,
        url,
        title: (fm.get('title') ?? '').replace(/^["']|["']$/g, ''),
        category: (fm.get('category') ?? '其他').replace(/^["']|["']$/g, ''),
        keywords: parseArrayField(fm.get('keywords') ?? '').map(k => k.toLowerCase()),
        author: (fm.get('author') ?? '').replace(/^["']|["']$/g, ''),
      });
    } catch { /* skip unreadable */ }
  }

  logger.info('suggest', '載入筆記索引', { count: notes.length });
  return notes;
}

/** Try loading VaultKnowledge from disk (returns null on failure) */
async function tryLoadKnowledge(): Promise<VaultKnowledge | null> {
  try {
    const raw = await readFile(KNOWLEDGE_PATH, 'utf-8');
    return JSON.parse(raw) as VaultKnowledge;
  } catch {
    return null;
  }
}

/** Layer 1: Entity-based suggestions via knowledge graph */
function entitySuggestions(
  noteUrl: string, knowledge: VaultKnowledge, noteIndex: NoteInfo[],
): LinkSuggestion[] {
  const related = findRelatedNotes(knowledge, noteUrl, 10);
  const pathMap = new Map(noteIndex.map(n => [n.url, n]));

  return related.map(r => {
    const info = pathMap.get(r.noteId);
    return {
      noteId: r.noteId,
      filePath: info?.filePath ?? '',
      title: r.title,
      sharedKeywords: r.sharedEntities,
      score: r.sharedEntities.length * 2 + r.qualityScore * 0.1,
      method: 'entity' as const,
    };
  }).filter(s => s.filePath);
}

/** Layer 2: Keyword/category matching from frontmatter */
function keywordSuggestions(
  note: NoteInfo, noteIndex: NoteInfo[], limit: number,
): LinkSuggestion[] {
  const myKw = new Set(note.keywords);
  if (myKw.size === 0 && !note.category) return [];

  const scored: LinkSuggestion[] = [];

  for (const other of noteIndex) {
    if (other.url === note.url) continue;

    const shared: string[] = [];
    let score = 0;

    // Keyword intersection (weight 1.0 each)
    for (const kw of other.keywords) {
      if (myKw.has(kw)) {
        shared.push(kw);
        score += 1.0;
      }
    }

    // Same category (weight 0.5)
    if (note.category && other.category === note.category) score += 0.5;

    // Same author (weight 0.3)
    if (note.author && other.author === note.author) score += 0.3;

    if (score >= 0.5) {
      scored.push({
        noteId: other.url,
        filePath: other.filePath,
        title: other.title,
        sharedKeywords: shared.length > 0 ? shared : [note.category],
        score,
        method: 'keyword',
      });
    }
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** Find related notes for a single note using two-layer fallback */
export async function suggestLinks(
  noteUrl: string, noteIndex: NoteInfo[], opts: SuggestOptions = {},
): Promise<LinkSuggestion[]> {
  const limit = opts.limit ?? 5;
  const minScore = opts.minScore ?? 0.3;

  const knowledge = await tryLoadKnowledge();
  const seen = new Map<string, LinkSuggestion>();

  // Layer 1: Entity-based (if knowledge available)
  if (knowledge && knowledge.notes[noteUrl]) {
    for (const s of entitySuggestions(noteUrl, knowledge, noteIndex)) {
      if (s.score >= minScore) seen.set(s.noteId, s);
    }
  }

  // Layer 2: Keyword-based (always available)
  const note = noteIndex.find(n => n.url === noteUrl);
  if (note) {
    for (const s of keywordSuggestions(note, noteIndex, limit * 2)) {
      if (s.score >= minScore && !seen.has(s.noteId)) {
        seen.set(s.noteId, s);
      }
    }
  }

  return [...seen.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** Batch suggest for all notes in vault */
export async function suggestAllLinks(
  vaultPath: string, opts: SuggestOptions = {},
): Promise<Map<string, LinkSuggestion[]>> {
  const noteIndex = await loadNoteIndex(vaultPath);
  const results = new Map<string, LinkSuggestion[]>();

  for (const note of noteIndex) {
    const suggestions = await suggestLinks(note.url, noteIndex, opts);
    if (suggestions.length > 0) {
      results.set(note.filePath, suggestions);
    }
  }

  logger.info('suggest', '推薦完成', {
    notes: noteIndex.length,
    withLinks: results.size,
  });
  return results;
}

/** Get the wikilink-friendly basename (without extension) */
export function noteBasename(filePath: string): string {
  return basename(filePath, '.md');
}
