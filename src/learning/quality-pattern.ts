/**
 * Quality pattern learner — analyzes characteristics of high-scoring notes
 * to identify what makes content valuable and inform future prioritization.
 * Zero LLM cost: pure statistical analysis on benchmark data + vault metadata.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { BenchmarkData } from '../monitoring/benchmark-types.js';
import { loadBenchmarkData } from '../monitoring/benchmark-store.js';
import { getAllMdFiles } from '../vault/frontmatter-utils.js';

export interface QualityPattern {
  /** Sources that produce higher quality content */
  bestSources: Array<{ source: string; avgScore: number; count: number }>;
  /** Categories with highest enrichment scores */
  bestCategories: Array<{ category: string; avgScore: number; count: number }>;
  /** Optimal content length ranges for high scores */
  optimalLengthRange: { min: number; max: number };
  /** Keywords frequently appearing in high-quality notes */
  highQualityKeywords: string[];
}

/** Parse frontmatter field */
function fm(raw: string, field: string): string {
  const m = raw.match(new RegExp(`^${field}:\\s*"?([^"\\n]+)"?\\s*$`, 'm'));
  return m?.[1]?.trim() ?? '';
}

function parseKeywords(raw: string): string[] {
  const m = raw.match(/^keywords:\s*\[(.+?)\]/m);
  if (!m) return [];
  return m[1].split(',').map(k => k.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
}

/** Analyze quality patterns from benchmark data and vault notes */
export async function analyzeQualityPatterns(vaultPath: string): Promise<QualityPattern> {
  const benchData = await loadBenchmarkData();
  const files = await getAllMdFiles(join(vaultPath, 'GetThreads'));

  // Build note metadata index
  const noteMeta = new Map<string, { source: string; category: string; keywords: string[]; bodyLen: number }>();
  for (const f of files) {
    try {
      const raw = await readFile(f, 'utf-8');
      const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      if (!fmMatch) continue;
      const head = fmMatch[1];
      const url = fm(head, 'url');
      if (!url) continue;
      const bodyStart = raw.indexOf('\n---\n', 3) + 5;
      noteMeta.set(url, {
        source: fm(head, 'source') || '未知',
        category: fm(head, 'category') || '其他',
        keywords: parseKeywords(head),
        bodyLen: raw.length - bodyStart,
      });
    } catch { /* skip */ }
  }

  // Aggregate by source
  const sourceScores = new Map<string, number[]>();
  const catScores = new Map<string, number[]>();
  const highQualityLengths: number[] = [];
  const kwCounts = new Map<string, number>();

  for (const [url, entry] of Object.entries(benchData.scores)) {
    const meta = noteMeta.get(url);
    if (!meta) continue;

    const score = entry.score.overall;

    // Source aggregation
    if (!sourceScores.has(meta.source)) sourceScores.set(meta.source, []);
    sourceScores.get(meta.source)!.push(score);

    // Category aggregation
    if (!catScores.has(meta.category)) catScores.set(meta.category, []);
    catScores.get(meta.category)!.push(score);

    // High quality analysis (score > 70)
    if (score > 70) {
      highQualityLengths.push(meta.bodyLen);
      for (const kw of meta.keywords) {
        kwCounts.set(kw, (kwCounts.get(kw) ?? 0) + 1);
      }
    }
  }

  // Best sources
  const bestSources = [...sourceScores.entries()]
    .map(([source, scores]) => ({
      source,
      avgScore: Math.round(scores.reduce((s, v) => s + v, 0) / scores.length),
      count: scores.length,
    }))
    .filter(s => s.count >= 3)
    .sort((a, b) => b.avgScore - a.avgScore);

  // Best categories
  const bestCategories = [...catScores.entries()]
    .map(([category, scores]) => ({
      category,
      avgScore: Math.round(scores.reduce((s, v) => s + v, 0) / scores.length),
      count: scores.length,
    }))
    .filter(c => c.count >= 2)
    .sort((a, b) => b.avgScore - a.avgScore);

  // Optimal length
  const sortedLens = highQualityLengths.sort((a, b) => a - b);
  const optimalLengthRange = sortedLens.length > 0
    ? { min: sortedLens[Math.floor(sortedLens.length * 0.25)], max: sortedLens[Math.floor(sortedLens.length * 0.75)] }
    : { min: 200, max: 2000 };

  // High quality keywords
  const highQualityKeywords = [...kwCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([kw]) => kw);

  return { bestSources, bestCategories, optimalLengthRange, highQualityKeywords };
}

/** Format quality patterns for display */
export function formatQualityPatterns(patterns: QualityPattern): string {
  const lines = ['🎯 品質模式分析', ''];

  if (patterns.bestSources.length > 0) {
    lines.push('【最佳來源】');
    for (const s of patterns.bestSources.slice(0, 5)) {
      lines.push(`  ${s.source}: ${s.avgScore}/100 (${s.count} 篇)`);
    }
    lines.push('');
  }

  if (patterns.bestCategories.length > 0) {
    lines.push('【最佳分類】');
    for (const c of patterns.bestCategories.slice(0, 5)) {
      lines.push(`  ${c.category}: ${c.avgScore}/100 (${c.count} 篇)`);
    }
    lines.push('');
  }

  lines.push(`【最佳內容長度】${patterns.optimalLengthRange.min}-${patterns.optimalLengthRange.max} 字元`);
  lines.push('');

  if (patterns.highQualityKeywords.length > 0) {
    lines.push(`【高品質關鍵字】${patterns.highQualityKeywords.slice(0, 10).join('、')}`);
  }

  return lines.join('\n');
}
