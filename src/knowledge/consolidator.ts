/**
 * Knowledge consolidation — discover cross-note connections among recent notes,
 * cluster them by shared entities, and use LLM to synthesize narrative insights.
 * Hybrid approach: statistical graph for connections + LLM for semantic synthesis.
 */
import type { VaultKnowledge, NoteAnalysis } from './types.js';
import { findRelatedNotes } from './knowledge-graph.js';
import { runLocalLlmPrompt } from '../utils/local-llm.js';
import { logger } from '../core/logger.js';

/* ── Types ────────────────────────────────────────────────── */

interface ClusterNote {
  noteId: string;
  title: string;
  category: string;
}

export interface NoteCluster {
  id: string;
  notes: ClusterNote[];
  sharedEntities: string[];
  categorySpan: string[];
  avgQuality: number;
  llmInsight?: string;
}

export interface ConsolidationReport {
  generatedAt: string;
  periodStart: string;
  periodEnd: string;
  newNoteCount: number;
  clusterCount: number;
  clusters: NoteCluster[];
  topNewEntities: string[];
  llmCallCount: number;
}

interface ConsolidateOptions {
  daysBack?: number;
  maxLlmCalls?: number;
}

/* ── Date helpers ─────────────────────────────────────────── */

function parseNoteDate(rawContent: string, filePath: string): string {
  const m = rawContent.match(/^date:\s*(\d{4}-\d{2}-\d{2})/m);
  if (m) return m[1];
  const fm = filePath.match(/(\d{4}-\d{2}-\d{2})/);
  return fm?.[1] ?? '';
}

function daysAgoStr(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

/* ── Auto-consolidation check ─────────────────────────────── */

export function shouldAutoConsolidate(knowledge: VaultKnowledge): boolean {
  const last = (knowledge as VaultKnowledge & { lastConsolidatedAt?: string }).lastConsolidatedAt;
  if (!last) return true;
  const daysSince = (Date.now() - new Date(last).getTime()) / 86_400_000;
  return daysSince >= 7;
}

function stampConsolidation(knowledge: VaultKnowledge): void {
  (knowledge as VaultKnowledge & { lastConsolidatedAt?: string }).lastConsolidatedAt =
    new Date().toISOString();
}

/* ── Filter recent notes ──────────────────────────────────── */

function filterRecentNotes(
  notes: Array<{ noteId: string; rawContent: string; filePath: string }>,
  knowledge: VaultKnowledge,
  daysBack: number,
): NoteAnalysis[] {
  const cutoff = daysAgoStr(daysBack);
  const recent: NoteAnalysis[] = [];

  for (const note of notes) {
    const date = parseNoteDate(note.rawContent, note.filePath);
    if (!date || date < cutoff) continue;
    const analysis = knowledge.notes[note.noteId];
    if (analysis) recent.push(analysis);
  }

  return recent;
}

/* ── Cluster building via shared entities ──────────────────── */

function buildNoteClusters(
  recentNotes: NoteAnalysis[],
  knowledge: VaultKnowledge,
): NoteCluster[] {
  // For each recent note, find related notes (including older ones)
  const edges = new Map<string, Map<string, string[]>>(); // noteA → noteB → sharedEntities

  for (const note of recentNotes) {
    const related = findRelatedNotes(knowledge, note.noteId, 15);
    for (const rel of related) {
      const key = [note.noteId, rel.noteId].sort().join('|');
      if (!edges.has(key)) {
        edges.set(key, new Map());
      }
      edges.get(key)!.set('entities', rel.sharedEntities);
      edges.get(key)!.set('a', [note.noteId]);
      edges.get(key)!.set('b', [rel.noteId]);
    }
  }

  // Union-find to merge overlapping note pairs into clusters
  const parent = new Map<string, string>();
  function find(x: string): string {
    if (!parent.has(x)) parent.set(x, x);
    if (parent.get(x) !== x) parent.set(x, find(parent.get(x)!));
    return parent.get(x)!;
  }
  function union(a: string, b: string): void {
    parent.set(find(a), find(b));
  }

  const noteEntities = new Map<string, Set<string>>(); // noteId → entity set

  for (const [key, data] of edges) {
    const [a, b] = key.split('|');
    union(a, b);
    const entities = data.get('entities') ?? [];
    for (const e of entities) {
      if (!noteEntities.has(a)) noteEntities.set(a, new Set());
      if (!noteEntities.has(b)) noteEntities.set(b, new Set());
      noteEntities.get(a)!.add(e);
      noteEntities.get(b)!.add(e);
    }
  }

  // Group by root
  const groups = new Map<string, Set<string>>();
  for (const noteId of parent.keys()) {
    const root = find(noteId);
    if (!groups.has(root)) groups.set(root, new Set());
    groups.get(root)!.add(noteId);
  }

  // Build clusters (≥3 notes)
  const recentIds = new Set(recentNotes.map(n => n.noteId));
  const clusters: NoteCluster[] = [];
  let idx = 0;

  for (const members of groups.values()) {
    if (members.size < 3) continue;
    // Must include at least 1 recent note
    if (![...members].some(id => recentIds.has(id))) continue;

    // Collect shared entities across all members
    const entityCounts = new Map<string, number>();
    for (const id of members) {
      for (const e of noteEntities.get(id) ?? []) {
        entityCounts.set(e, (entityCounts.get(e) ?? 0) + 1);
      }
    }
    const shared = [...entityCounts.entries()]
      .filter(([, c]) => c >= 2)
      .sort((a, b) => b[1] - a[1])
      .map(([e]) => e);

    if (shared.length === 0) continue;

    const clusterNotes: ClusterNote[] = [];
    let qualitySum = 0;
    const categories = new Set<string>();

    for (const id of members) {
      const a = knowledge.notes[id];
      if (!a) continue;
      clusterNotes.push({ noteId: id, title: a.title, category: a.category });
      qualitySum += a.qualityScore;
      categories.add(a.category);
    }

    clusters.push({
      id: `cluster-${idx++}`,
      notes: clusterNotes,
      sharedEntities: shared.slice(0, 8),
      categorySpan: [...categories],
      avgQuality: Math.round((qualitySum / clusterNotes.length) * 10) / 10,
    });
  }

  // Sort by notes × entities (descending)
  return clusters.sort((a, b) =>
    b.notes.length * b.sharedEntities.length - a.notes.length * a.sharedEntities.length,
  );
}

/* ── LLM enrichment ───────────────────────────────────────── */

async function enrichClustersWithLlm(
  clusters: NoteCluster[],
  knowledge: VaultKnowledge,
  maxCalls: number,
): Promise<number> {
  let calls = 0;
  for (const cluster of clusters.slice(0, maxCalls)) {
    const summaries = cluster.notes.map(n => {
      const a = knowledge.notes[n.noteId];
      const summary = a?.insights[0]?.content ?? n.title;
      return `- ${n.title}：${summary.slice(0, 80)}`;
    }).join('\n');

    const prompt = [
      `你是知識整合助手。以下 ${cluster.notes.length} 篇筆記都與 [${cluster.sharedEntities.slice(0, 4).join('、')}] 相關：`,
      summaries,
      '',
      '請用繁體中文，用 2-3 句話回答：',
      '1. 這些內容共同揭示了什麼趨勢或模式？',
      '2. 對個人知識管理或工具使用有什麼實際建議？',
      '只回答文字，不加標號或格式。',
    ].join('\n');

    const result = await runLocalLlmPrompt(prompt, { timeoutMs: 30_000 });
    if (result) {
      cluster.llmInsight = result.trim();
      calls++;
    }
  }
  return calls;
}

/* ── Detect new entities ──────────────────────────────────── */

function findNewEntities(
  recentNotes: NoteAnalysis[],
  knowledge: VaultKnowledge,
): string[] {
  const recentEntities = new Set<string>();
  for (const note of recentNotes) {
    for (const e of note.entities) recentEntities.add(e.name.toLowerCase());
  }

  const oldEntities = new Set<string>();
  const recentIds = new Set(recentNotes.map(n => n.noteId));
  for (const note of Object.values(knowledge.notes)) {
    if (recentIds.has(note.noteId)) continue;
    for (const e of note.entities) oldEntities.add(e.name.toLowerCase());
  }

  return [...recentEntities].filter(e => !oldEntities.has(e));
}

/* ── Main consolidation ───────────────────────────────────── */

export async function consolidateVault(
  notes: Array<{ noteId: string; rawContent: string; filePath: string }>,
  knowledge: VaultKnowledge,
  options: ConsolidateOptions = {},
): Promise<ConsolidationReport> {
  const daysBack = options.daysBack ?? 7;
  const maxLlmCalls = options.maxLlmCalls ?? 5;

  const recentNotes = filterRecentNotes(notes, knowledge, daysBack);
  const periodStart = daysAgoStr(daysBack);
  const periodEnd = new Date().toISOString().slice(0, 10);

  logger.info('consolidate', '開始整合', { recent: recentNotes.length, daysBack });

  const clusters = buildNoteClusters(recentNotes, knowledge);
  const llmCallCount = clusters.length > 0
    ? await enrichClustersWithLlm(clusters, knowledge, maxLlmCalls)
    : 0;

  const newEntities = findNewEntities(recentNotes, knowledge);

  stampConsolidation(knowledge);

  return {
    generatedAt: new Date().toISOString(),
    periodStart,
    periodEnd,
    newNoteCount: recentNotes.length,
    clusterCount: clusters.length,
    clusters,
    topNewEntities: newEntities.slice(0, 15),
    llmCallCount,
  };
}
