/**
 * Knowledge graph — entity relationships, related notes discovery,
 * knowledge gap detection, and Map of Content generation.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { join, basename, dirname } from 'node:path';
import type { VaultKnowledge, NoteAnalysis, EntityType } from './types.js';
import { getTopEntities } from './knowledge-aggregator.js';

/** Adjacency graph built from entity co-occurrence */
export interface EntityGraph {
  /** entity (lowercase) → set of connected entity names (lowercase) */
  adjacency: Map<string, Set<string>>;
  /** entity (lowercase) → noteIds where it appears */
  notesByEntity: Map<string, string[]>;
}

/** A note related to another via shared entities */
export interface RelatedNote {
  noteId: string;
  title: string;
  sharedEntities: string[];
  qualityScore: number;
}

/** A detected knowledge gap */
export interface KnowledgeGap {
  entity: string;
  type: EntityType;
  mentions: number;
  insightCount: number;
  avgQuality: number;
  suggestion: string;
}

/** Build entity co-occurrence graph from knowledge base */
export function buildEntityGraph(knowledge: VaultKnowledge): EntityGraph {
  const adjacency = new Map<string, Set<string>>();
  const notesByEntity = new Map<string, string[]>();

  for (const note of Object.values(knowledge.notes)) {
    const entityKeys = note.entities.map(e => e.name.toLowerCase().trim());

    for (const key of entityKeys) {
      if (!notesByEntity.has(key)) notesByEntity.set(key, []);
      notesByEntity.get(key)!.push(note.noteId);
    }

    // Co-occurrence: entities in the same note are connected
    for (let i = 0; i < entityKeys.length; i++) {
      if (!adjacency.has(entityKeys[i])) adjacency.set(entityKeys[i], new Set());
      for (let j = i + 1; j < entityKeys.length; j++) {
        if (!adjacency.has(entityKeys[j])) adjacency.set(entityKeys[j], new Set());
        adjacency.get(entityKeys[i])!.add(entityKeys[j]);
        adjacency.get(entityKeys[j])!.add(entityKeys[i]);
      }
    }
  }

  return { adjacency, notesByEntity };
}

/** Find notes related to a given noteId by shared entities (≥2 shared) */
export function findRelatedNotes(knowledge: VaultKnowledge, noteId: string, limit = 5): RelatedNote[] {
  const note = knowledge.notes[noteId];
  if (!note) return [];

  const myEntities = new Set(note.entities.map(e => e.name.toLowerCase().trim()));
  const candidates = new Map<string, string[]>();

  for (const other of Object.values(knowledge.notes)) {
    if (other.noteId === noteId) continue;
    const shared: string[] = [];
    for (const e of other.entities) {
      if (myEntities.has(e.name.toLowerCase().trim())) shared.push(e.name);
    }
    if (shared.length >= 2) candidates.set(other.noteId, shared);
  }

  return [...candidates.entries()]
    .map(([id, shared]) => ({
      noteId: id,
      title: knowledge.notes[id].title,
      sharedEntities: shared,
      qualityScore: knowledge.notes[id].qualityScore,
    }))
    .sort((a, b) => b.sharedEntities.length - a.sharedEntities.length || b.qualityScore - a.qualityScore)
    .slice(0, limit);
}

/** Detect knowledge gaps — popular entities with shallow coverage */
export function detectKnowledgeGaps(knowledge: VaultKnowledge): KnowledgeGap[] {
  if (!knowledge.globalEntities) return [];
  const gaps: KnowledgeGap[] = [];

  for (const entity of Object.values(knowledge.globalEntities)) {
    if (entity.mentions < 2) continue; // Skip single-mention entities

    // Count insights related to this entity
    let insightCount = 0;
    let qualitySum = 0;
    let noteCount = 0;
    for (const noteId of entity.noteIds) {
      const note = knowledge.notes[noteId];
      if (!note) continue;
      noteCount++;
      qualitySum += note.qualityScore;
      insightCount += note.insights.filter(ins =>
        ins.entities.some(e => e.toLowerCase() === entity.name.toLowerCase()),
      ).length;
    }

    const avgQuality = noteCount > 0 ? Math.round((qualitySum / noteCount) * 10) / 10 : 0;

    // Gap: many mentions but few insights or low quality
    if (insightCount < entity.mentions || avgQuality < 3) {
      gaps.push({
        entity: entity.name,
        type: entity.type as EntityType,
        mentions: entity.mentions,
        insightCount,
        avgQuality,
        suggestion: insightCount < 2
          ? `${entity.name} 有 ${entity.mentions} 篇提及但僅 ${insightCount} 條洞察，建議深入研究`
          : `${entity.name} 平均品質 ${avgQuality}/5，建議尋找更深入的分析文章`,
      });
    }
  }

  return gaps.sort((a, b) => b.mentions - a.mentions);
}

/** Format knowledge gaps for Telegram message */
export function formatGapsSummary(gaps: KnowledgeGap[]): string {
  const typeLabel: Record<string, string> = {
    tool: '工具', concept: '概念', person: '人物', framework: '框架',
    company: '公司', technology: '技術', platform: '平台', language: '語言',
  };

  const lines = ['🔍 知識缺口分析', ''];
  if (gaps.length === 0) {
    lines.push('✅ 未偵測到明顯知識缺口。');
    return lines.join('\n');
  }

  lines.push(`發現 ${gaps.length} 個缺口：`, '');
  for (const g of gaps.slice(0, 10)) {
    lines.push(`• ${g.entity} [${typeLabel[g.type] ?? g.type}]`);
    lines.push(`  ${g.suggestion}`);
  }

  return lines.join('\n');
}

/** Generate an Obsidian Map of Content note */
export async function generateMocNote(vaultPath: string, knowledge: VaultKnowledge): Promise<string> {
  const outPath = join(vaultPath, 'GetThreads', '知識地圖.md');
  const now = new Date().toLocaleDateString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit' });
  const noteLink = (n: NoteAnalysis) => `[[${basename(n.filePath, '.md')}|${n.title.slice(0, 45)}]]`;

  const L: string[] = [];
  L.push('---', `title: 知識地圖`, `date: ${now}`, 'tags: [knowledge, moc, auto-generated]', '---');
  L.push('', '# 知識地圖 (Map of Content)', '');
  L.push(`> 自動產生於 ${now}，基於 ${Object.keys(knowledge.notes).length} 篇筆記。`, '');

  // Group notes by category
  const byCategory: Record<string, NoteAnalysis[]> = {};
  for (const note of Object.values(knowledge.notes)) {
    const cat = note.category || '其他';
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(note);
  }

  for (const [cat, notes] of Object.entries(byCategory).sort((a, b) => b[1].length - a[1].length)) {
    const sorted = notes.sort((a, b) => b.qualityScore - a.qualityScore);
    L.push(`## ${cat}（${notes.length} 篇）`, '');
    for (const n of sorted) {
      const stars = '⭐'.repeat(Math.min(n.qualityScore, 5));
      L.push(`- ${stars} ${noteLink(n)}`);
    }
    L.push('');
  }

  // Entity clusters
  const topEntities = getTopEntities(knowledge, 10);
  if (topEntities.length > 0) {
    L.push('## 核心實體關聯', '');
    const graph = buildEntityGraph(knowledge);
    for (const e of topEntities.slice(0, 5)) {
      const key = e.name.toLowerCase().trim();
      const connected = graph.adjacency.get(key);
      if (connected && connected.size > 0) {
        const connList = [...connected].slice(0, 5).join(', ');
        L.push(`- **${e.name}**（${e.mentions} 篇）→ ${connList}`);
      }
    }
    L.push('');
  }

  // Knowledge gaps
  const gaps = detectKnowledgeGaps(knowledge);
  if (gaps.length > 0) {
    L.push('## 知識缺口', '');
    for (const g of gaps.slice(0, 5)) {
      L.push(`- ⚠️ ${g.suggestion}`);
    }
    L.push('');
  }

  L.push('---');
  L.push(`*自動產生 by GetThreads /vault-analyze — ${new Date().toISOString().slice(0, 19)}*`);

  const content = L.join('\n');
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, content, 'utf-8');
  return outPath;
}
