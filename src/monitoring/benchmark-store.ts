/**
 * Benchmark data persistence — tracks enrichment scores and platform stats.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { BenchmarkData, BenchmarkReport, PlatformStats } from './benchmark-types.js';

const DATA_PATH = join('data', 'benchmark-data.json');
const MAX_SCORES = 500; // Keep last 500 note scores

let cached: BenchmarkData | null = null;

function defaultData(): BenchmarkData {
  return { scores: {}, platformAttempts: {}, lastUpdatedAt: new Date().toISOString() };
}

export async function loadBenchmarkData(): Promise<BenchmarkData> {
  if (cached) return cached;
  try {
    const raw = await readFile(DATA_PATH, 'utf-8');
    cached = { ...defaultData(), ...JSON.parse(raw) };
    return cached!;
  } catch {
    cached = defaultData();
    return cached;
  }
}

export async function saveBenchmarkData(data: BenchmarkData): Promise<void> {
  // Trim old entries if over limit
  const urls = Object.keys(data.scores);
  if (urls.length > MAX_SCORES) {
    const sorted = urls.sort(
      (a, b) => new Date(data.scores[a].timestamp).getTime() - new Date(data.scores[b].timestamp).getTime(),
    );
    for (const url of sorted.slice(0, urls.length - MAX_SCORES)) {
      delete data.scores[url];
    }
  }

  data.lastUpdatedAt = new Date().toISOString();
  cached = data;
  await mkdir(dirname(DATA_PATH), { recursive: true });
  await writeFile(DATA_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

/** Record platform extraction attempt */
export function recordPlatformAttempt(
  data: BenchmarkData,
  platform: string,
  success: boolean,
): void {
  if (!data.platformAttempts[platform]) {
    data.platformAttempts[platform] = { success: 0, failure: 0 };
  }
  if (success) data.platformAttempts[platform].success++;
  else data.platformAttempts[platform].failure++;
}

/** Generate benchmark report from stored data */
export function generateBenchmarkReport(data: BenchmarkData): BenchmarkReport {
  const scores = Object.values(data.scores);
  const now = Date.now();
  const recentCutoff = now - 7 * 86_400_000;
  const prevCutoff = now - 14 * 86_400_000;

  // Overall stats
  const avgOverall = scores.length > 0
    ? Math.round(scores.reduce((s, e) => s + e.score.overall, 0) / scores.length)
    : 0;

  // Score distribution
  const dist: Record<string, number> = {};
  for (const entry of scores) {
    const bucket = `${Math.floor(entry.score.overall / 10) * 10}-${Math.floor(entry.score.overall / 10) * 10 + 10}`;
    dist[bucket] = (dist[bucket] ?? 0) + 1;
  }

  // Platform stats
  const platformStats: PlatformStats[] = [];
  for (const [platform, attempts] of Object.entries(data.platformAttempts)) {
    const total = attempts.success + attempts.failure;
    const platformScores = scores.filter(s => s.platform === platform);
    const avgScore = platformScores.length > 0
      ? Math.round(platformScores.reduce((s, e) => s + e.score.overall, 0) / platformScores.length)
      : 0;

    platformStats.push({
      platform,
      totalAttempts: total,
      successCount: attempts.success,
      failureCount: attempts.failure,
      avgEnrichScore: avgScore,
      successRate: total > 0 ? Math.round(attempts.success / total * 100) : 0,
    });
  }
  platformStats.sort((a, b) => b.totalAttempts - a.totalAttempts);

  // Quality trend
  const recentScores = scores.filter(s => new Date(s.timestamp).getTime() >= recentCutoff);
  const prevScores = scores.filter(s => {
    const ts = new Date(s.timestamp).getTime();
    return ts >= prevCutoff && ts < recentCutoff;
  });

  const recentAvg = recentScores.length > 0
    ? recentScores.reduce((s, e) => s + e.score.overall, 0) / recentScores.length
    : avgOverall;
  const prevAvg = prevScores.length > 0
    ? prevScores.reduce((s, e) => s + e.score.overall, 0) / prevScores.length
    : avgOverall;

  let qualityTrend: 'improving' | 'stable' | 'declining' = 'stable';
  if (recentAvg > prevAvg + 5) qualityTrend = 'improving';
  else if (recentAvg < prevAvg - 5) qualityTrend = 'declining';

  return {
    generatedAt: new Date().toISOString(),
    period: '近 7 天',
    totalEnriched: scores.length,
    avgOverallScore: avgOverall,
    platformStats,
    scoreDistribution: dist,
    qualityTrend,
  };
}

/** Format benchmark report for Telegram */
export function formatBenchmarkReport(report: BenchmarkReport): string {
  const trendIcon = { improving: '📈', stable: '➡️', declining: '📉' }[report.qualityTrend];
  const lines = [
    '📊 品質基準報告',
    '',
    `總評分筆記：${report.totalEnriched} 篇`,
    `平均品質分：${report.avgOverallScore}/100 ${trendIcon} ${report.qualityTrend}`,
    '',
  ];

  if (report.platformStats.length > 0) {
    lines.push('【平台成功率】');
    for (const p of report.platformStats.slice(0, 8)) {
      const bar = '█'.repeat(Math.round(p.successRate / 10));
      lines.push(`  ${p.platform}: ${p.successRate}% ${bar} (${p.totalAttempts}次)`);
    }
    lines.push('');
  }

  const distEntries = Object.entries(report.scoreDistribution).sort();
  if (distEntries.length > 0) {
    lines.push('【分數分佈】');
    for (const [bucket, count] of distEntries) {
      lines.push(`  ${bucket}: ${'█'.repeat(Math.min(count, 20))} ${count}`);
    }
  }

  return lines.join('\n');
}
