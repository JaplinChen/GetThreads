/**
 * Enrichment quality scorer — evaluates AI enrichment output quality.
 * Zero LLM cost: rule-based scoring on field completeness and heuristics.
 */
import type { EnrichmentScore } from './benchmark-types.js';

const EMOTIONAL_WORDS = new Set([
  '太棒', '超讚', '太猛', '太震撼', '巨好用', '超強', '爆紅', '狂推',
  '必看', '必學', '太扯', '天啊', '哇靠', '絕了', '神級', '逆天',
]);

/** Score summary quality (0-1) */
function scoreSummary(summary: string | null | undefined): number {
  if (!summary) return 0;
  const len = summary.length;

  let score = 0;

  // Length scoring: ideal 40-120 chars
  if (len >= 40 && len <= 120) score += 0.4;
  else if (len >= 20 && len <= 200) score += 0.2;
  else score += 0.05;

  // No emotional language
  const hasEmotional = [...EMOTIONAL_WORDS].some(w => summary.includes(w));
  score += hasEmotional ? 0 : 0.3;

  // Has concrete content (contains numbers, tool names, or specific terms)
  const hasSpecific = /\d/.test(summary) || /[A-Z][a-z]/.test(summary);
  score += hasSpecific ? 0.3 : 0.1;

  return Math.min(score, 1);
}

/** Score keyword relevance (0-1): overlap between keywords and title/body */
function scoreKeywords(
  keywords: string[] | null | undefined,
  title: string,
  text: string,
): number {
  if (!keywords || keywords.length === 0) return 0;

  const combined = `${title} ${text}`.toLowerCase();
  let relevant = 0;

  for (const kw of keywords) {
    if (combined.includes(kw.toLowerCase())) relevant++;
  }

  const relevanceRate = relevant / keywords.length;

  let score = 0;
  // 3-5 keywords is ideal
  if (keywords.length >= 3 && keywords.length <= 5) score += 0.3;
  else if (keywords.length >= 1) score += 0.15;

  // Relevance
  score += relevanceRate * 0.7;

  return Math.min(score, 1);
}

/** Score classification accuracy (0-1) */
function scoreClassification(category: string | undefined): number {
  if (!category) return 0;
  if (category === '其他') return 0.3;
  // Has sub-category (e.g. AI/Claude)
  if (category.includes('/')) return 1;
  return 0.7;
}

/** Score field completeness (0-1) */
function scoreCompleteness(fields: {
  keywords: unknown;
  summary: unknown;
  analysis: unknown;
  keyPoints: unknown;
  title: unknown;
  category: unknown;
}): number {
  const checks = [
    fields.keywords != null,
    fields.summary != null,
    fields.analysis != null,
    fields.keyPoints != null,
    fields.title != null,
    fields.category != null,
  ];
  return checks.filter(Boolean).length / checks.length;
}

/** Compute enrichment quality score for a single note */
export function computeEnrichmentScore(
  enriched: {
    keywords?: string[] | null;
    summary?: string | null;
    analysis?: string | null;
    keyPoints?: string[] | null;
    title?: string;
    category?: string;
  },
  originalTitle: string,
  originalText: string,
): EnrichmentScore {
  const summaryScore = scoreSummary(enriched.summary);
  const keywordScore = scoreKeywords(enriched.keywords, originalTitle, originalText);
  const classificationScore = scoreClassification(enriched.category);
  const completenessScore = scoreCompleteness({
    keywords: enriched.keywords,
    summary: enriched.summary,
    analysis: enriched.analysis,
    keyPoints: enriched.keyPoints,
    title: enriched.title,
    category: enriched.category,
  });

  const overall = Math.round(
    (summaryScore * 30 + keywordScore * 25 + classificationScore * 20 + completenessScore * 25),
  );

  return { summaryScore, keywordScore, classificationScore, completenessScore, overall };
}
