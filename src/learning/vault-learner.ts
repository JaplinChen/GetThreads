import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { logger } from '../core/logger.js';
import { parseFrontmatter, parseArrayField, getAllMdFiles } from '../vault/frontmatter-utils.js';
import { getFeedbackWeight, loadFeedbackStore } from './feedback-tracker.js';

export interface NoteStats {
  category: string;
  title: string;
  keywords: string[];
  titleTokens: string[];
  bodyTokens: string[];
}

export interface ClassificationRule {
  keyword: string;
  category: string;
  score: number;
  count: number;
}

export interface FormattingPatterns {
  commonTags: string[];
  topKeywordsByCategory: Record<string, string[]>;
}

export interface LearnedPatterns {
  version: number;
  generatedAt: string;
  stats: {
    totalNotes: number;
    categoryDist: Record<string, number>;
  };
  classificationRules: ClassificationRule[];
  formatting: FormattingPatterns;
}

const STOP_WORDS = new Set([
  // English
  'the', 'a', 'an', 'in', 'on', 'at', 'to', 'for', 'of', 'and', 'or', 'but',
  'is', 'are', 'was', 'this', 'that', 'with', 'from', 'by', 'as', 'be', 'it',
  'have', 'not', 'he', 'she', 'we', 'they', 'you', 'my', 'its', 'our', 'can',
  'will', 'do', 'does', 'did', 'has', 'had', 'would', 'could', 'should', 'may',
  'about', 'up', 'out', 'into', 'more', 'also', 'just', 'than', 'then', 'when',
  'what', 'how', 'if', 'all', 'each', 'any', 'some', 'one', 'two', 'new', 'use',
  // Chinese
  '的', '了', '在', '是', '我', '有', '和', '也', '就', '都', '而', '及', '與', '著',
  '或', '一個', '沒有', '我們', '你們', '他們', '這個', '那個',
  // URL / web noise
  'https', 'http', 'com', 'www', 'net', 'org', 'io', 'co',
  'html', 'htm', 'php', 'jpg', 'png', 'gif', 'view', 'original',
  'image', 'attachments', 'getthreads', 'source', 'archive',
]);

export function tokenize(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/["'“”‘’(){}<>\[\]]/g, ' ')
    .replace(/[.!?;:,/\\|@#$%^&*+=~`]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w));

  const tokens: string[] = [...words];
  for (let i = 0; i < words.length - 1; i++) {
    const bigram = `${words[i]} ${words[i + 1]}`;
    if (bigram.length >= 5) tokens.push(bigram);
  }
  return tokens;
}

export async function scanVaultNotes(vaultPath: string): Promise<NoteStats[]> {
  const files = await getAllMdFiles(join(vaultPath, 'GetThreads'));
  const notes: NoteStats[] = [];

  for (const f of files) {
    try {
      const raw = await readFile(f, 'utf-8');
      const fields = parseFrontmatter(raw);
      const category = fields.get('category');
      if (!category || category === '其他') continue;

      const title = (fields.get('title') ?? '').replace(/^"|"$/g, '');
      const keywords = parseArrayField(fields.get('keywords') ?? '');
      const bodyStart = raw.indexOf('\n---\n', 3) + 5;
      const bodyText = raw.slice(bodyStart, bodyStart + 500);

      notes.push({
        category,
        title,
        keywords,
        titleTokens: tokenize(title),
        bodyTokens: tokenize(bodyText),
      });
    } catch {
      // Skip unreadable files
    }
  }

  return notes;
}

export function computeClassificationRules(notes: NoteStats[]): ClassificationRule[] {
  const kwCat = new Map<string, Map<string, number>>();
  const kwTotal = new Map<string, number>();

  for (const note of notes) {
    const seen = new Set<string>();
    const tokens = [
      ...note.keywords.map((k) => k.toLowerCase()),
      ...note.keywords.map((k) => k.toLowerCase()), // weight x1.5
      ...note.titleTokens,
      ...note.bodyTokens.filter((_, i) => i % 2 === 0), // weight x0.5
    ];

    for (const token of tokens) {
      if (seen.has(token)) continue;
      seen.add(token);

      if (!kwCat.has(token)) kwCat.set(token, new Map());
      const cm = kwCat.get(token)!;
      cm.set(note.category, (cm.get(note.category) ?? 0) + 1);
      kwTotal.set(token, (kwTotal.get(token) ?? 0) + 1);
    }
  }

  const rules: ClassificationRule[] = [];
  for (const [keyword, catMap] of kwCat) {
    const total = kwTotal.get(keyword) ?? 0;
    if (total < 3) continue;

    let bestCat = '';
    let bestCount = 0;
    for (const [cat, count] of catMap) {
      if (count > bestCount) {
        bestCount = count;
        bestCat = cat;
      }
    }

    let score = Math.round((bestCount / total) * 100) / 100;
    // Apply feedback weight adjustment (±0.1 max per keyword)
    const feedbackBonus = Math.max(-0.1, Math.min(0.1, getFeedbackWeight(keyword, bestCat) * 0.02));
    score = Math.min(1, Math.max(0, score + feedbackBonus));
    if (score < 0.7) continue;
    rules.push({ keyword, category: bestCat, score, count: total });
  }

  return rules.sort((a, b) => b.score - a.score || b.count - a.count);
}

export function computeFormattingPatterns(notes: NoteStats[]): FormattingPatterns {
  const catKw = new Map<string, Map<string, number>>();

  for (const note of notes) {
    if (!catKw.has(note.category)) catKw.set(note.category, new Map());
    const m = catKw.get(note.category)!;
    for (const kw of note.keywords) {
      const k = kw.toLowerCase();
      m.set(k, (m.get(k) ?? 0) + 1);
    }
  }

  const topKeywordsByCategory: Record<string, string[]> = {};
  for (const [cat, m] of catKw) {
    topKeywordsByCategory[cat] = [...m.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([k]) => k);
  }

  return { commonTags: ['archive'], topKeywordsByCategory };
}

export async function runVaultLearner(vaultPath: string, outputPath: string): Promise<LearnedPatterns> {
  // Ensure feedback weights are loaded before computing rules
  await loadFeedbackStore().catch(() => {});
  const notes = await scanVaultNotes(vaultPath);
  const categoryDist: Record<string, number> = {};
  for (const n of notes) {
    categoryDist[n.category] = (categoryDist[n.category] ?? 0) + 1;
  }

  const classificationRules = computeClassificationRules(notes);
  const formatting = computeFormattingPatterns(notes);
  const patterns: LearnedPatterns = {
    version: 1,
    generatedAt: new Date().toISOString(),
    stats: { totalNotes: notes.length, categoryDist },
    classificationRules,
    formatting,
  };

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(patterns, null, 2), 'utf-8');
  logger.info('learn', '掃描完成', { notes: notes.length, rules: classificationRules.length });
  return patterns;
}
