/**
 * Persistent knowledge store — reads/writes vault-knowledge.json
 * with incremental update support via content hashing.
 */
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { logger } from '../core/logger.js';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { canonicalizeUrl } from '../utils/url-canonicalizer.js';
import type {
  VaultKnowledge, NoteAnalysis, KnowledgeEntity,
  KnowledgeInsight, KnowledgeRelation, AIAnalysisResponse,
} from './types.js';

export const KNOWLEDGE_PATH = join(process.cwd(), 'data', 'vault-knowledge.json');

/** In-memory cache — loaded once, updated incrementally */
let cachedKnowledge: VaultKnowledge | null = null;

/** Create an empty knowledge store */
function createEmpty(): VaultKnowledge {
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    stats: {
      totalNotes: 0, analyzedNotes: 0, totalEntities: 0,
      totalInsights: 0, totalRelations: 0, avgQualityScore: 0,
    },
    notes: {},
  };
}

/** Load knowledge from disk (or return cached). Silent fallback on missing file. */
export async function loadKnowledge(path = KNOWLEDGE_PATH): Promise<VaultKnowledge> {
  if (cachedKnowledge) return cachedKnowledge;
  try {
    const raw = await readFile(path, 'utf-8');
    cachedKnowledge = JSON.parse(raw) as VaultKnowledge;
    logger.info('knowledge', '載入知識快取', { notes: Object.keys(cachedKnowledge.notes).length });
    return cachedKnowledge;
  } catch {
    cachedKnowledge = createEmpty();
    return cachedKnowledge;
  }
}

/** Persist knowledge to disk and update cache */
export async function saveKnowledge(knowledge: VaultKnowledge, path = KNOWLEDGE_PATH): Promise<void> {
  knowledge.generatedAt = new Date().toISOString();
  cachedKnowledge = knowledge;
  await writeFile(path, JSON.stringify(knowledge, null, 2), 'utf-8');
}

/** Compute content hash (MD5 of first 2500 chars) for change detection */
export function computeContentHash(rawContent: string): string {
  const normalized = rawContent.slice(0, 2500).replace(/\r\n/g, '\n');
  return createHash('md5').update(normalized).digest('hex');
}

/** Check if a note needs (re-)analysis based on content hash */
export function shouldAnalyze(
  noteId: string, contentHash: string, knowledge: VaultKnowledge,
): boolean {
  const existing = knowledge.notes[noteId];
  if (!existing) return true;
  return existing.contentHash !== contentHash;
}

/** Convert AI response to a full NoteAnalysis */
export function buildNoteAnalysis(
  noteId: string, filePath: string, title: string, category: string,
  contentHash: string, response: AIAnalysisResponse,
): NoteAnalysis {
  const insightIdBase = createHash('md5').update(noteId).digest('hex').slice(0, 6);

  const entities: KnowledgeEntity[] = response.entities.map(e => ({
    name: e.name,
    type: e.type,
    aliases: e.aliases ?? [],
    mentions: 1,
    noteIds: [noteId],
  }));

  const insights: KnowledgeInsight[] = response.insights.map((ins, i) => ({
    id: `${insightIdBase}-${i}`,
    type: ins.type,
    content: ins.content,
    sourceNoteId: noteId,
    sourceTitle: title,
    entities: ins.relatedEntities ?? [],
    confidence: ins.confidence,
  }));

  const relations: KnowledgeRelation[] = response.relations.map(r => ({
    from: r.from,
    to: r.to,
    type: r.type,
    description: r.description,
    sourceNoteId: noteId,
  }));

  return {
    noteId, filePath, title, category, contentHash,
    qualityScore: response.qualityScore,
    entities, insights, relations,
    analyzedAt: new Date().toISOString(),
  };
}

/** Update or insert a single note analysis */
export function updateNoteAnalysis(knowledge: VaultKnowledge, analysis: NoteAnalysis): void {
  knowledge.notes[analysis.noteId] = analysis;
}

/** Remove analyses for notes that no longer exist in vault. Returns count removed. */
export function cleanupDeletedNotes(
  knowledge: VaultKnowledge, existingNoteIds: Set<string>,
): number {
  let removed = 0;
  for (const noteId of Object.keys(knowledge.notes)) {
    if (!existingNoteIds.has(noteId)) {
      delete knowledge.notes[noteId];
      removed++;
    }
  }
  return removed;
}

/** Scan vault for all .md notes, returning { noteId, filePath, title, category, rawContent } */
export async function scanVaultNotes(vaultPath: string): Promise<Array<{
  noteId: string; filePath: string; title: string; category: string; rawContent: string;
}>> {
  const rootDir = join(vaultPath, 'GetThreads');
  const results: Array<{
    noteId: string; filePath: string; title: string; category: string; rawContent: string;
  }> = [];

  async function scanDir(dir: string): Promise<void> {
    let entries: import('node:fs').Dirent<string>[];
    try {
      entries = await readdir(dir, { withFileTypes: true, encoding: 'utf-8' });
    } catch { return; }

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await scanDir(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        try {
          const raw = await readFile(fullPath, 'utf-8');
          const fm = raw.split('\n').slice(0, 25).join('\n');
          const urlMatch = fm.match(/^url:\s*["']?(.*?)["']?\s*$/m);
          const titleMatch = fm.match(/^title:\s*["']?(.*?)["']?\s*$/m);
          const catMatch = fm.match(/^category:\s*["']?(.*?)["']?\s*$/m);
          if (!urlMatch) continue;

          const url = urlMatch[1].trim();
          const noteId = canonicalizeUrl(url);
          const title = (titleMatch?.[1] ?? '').replace(/^["']|["']$/g, '').trim();
          const category = (catMatch?.[1] ?? '其他').replace(/^["']|["']$/g, '').trim();

          results.push({ noteId, filePath: fullPath, title, category, rawContent: raw });
        } catch { /* skip */ }
      }
    }
  }

  await scanDir(rootDir);
  return results;
}


