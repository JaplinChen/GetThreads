/**
 * Extractor health probe — periodically tests each platform extractor
 * with a known URL to detect API changes or blocks.
 */
import type { ExtractorHealth } from './health-types.js';
import { logger } from '../core/logger.js';

/** Probe URLs — lightweight, public, stable content for each platform */
const PROBE_URLS: Record<string, string> = {
  github: 'https://github.com/anthropics/claude-code',
  youtube: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  reddit: 'https://www.reddit.com/r/programming/comments/1a',
};

/** Test a single extractor by attempting to extract a known URL */
async function probeExtractor(
  platform: string,
  extractFn: (url: string) => Promise<unknown>,
  url: string,
  timeoutMs: number = 30_000,
): Promise<ExtractorHealth> {
  const now = new Date().toISOString();

  try {
    const result = await Promise.race([
      extractFn(url),
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), timeoutMs)),
    ]);

    if (result === 'timeout') {
      return { platform, status: 'degraded', lastCheckAt: now, lastError: '超時', consecutiveFailures: 1 };
    }

    return { platform, status: 'ok', lastCheckAt: now, consecutiveFailures: 0 };
  } catch (err) {
    return {
      platform,
      status: 'down',
      lastCheckAt: now,
      lastError: (err as Error).message.slice(0, 200),
      consecutiveFailures: 1,
    };
  }
}

/** Run health probes for all configured extractors */
export async function probeAllExtractors(
  extractors: Array<{ platform: string; extract: (url: string) => Promise<unknown> }>,
  previousHealth: Record<string, ExtractorHealth>,
): Promise<Record<string, ExtractorHealth>> {
  const results: Record<string, ExtractorHealth> = {};

  // Only probe extractors that have known probe URLs
  for (const ext of extractors) {
    const probeUrl = PROBE_URLS[ext.platform];
    if (!probeUrl) {
      // Keep previous health state or mark as unknown
      if (previousHealth[ext.platform]) {
        results[ext.platform] = previousHealth[ext.platform];
      }
      continue;
    }

    const health = await probeExtractor(ext.platform, ext.extract, probeUrl);

    // Track consecutive failures
    const prev = previousHealth[ext.platform];
    if (prev && health.status !== 'ok') {
      health.consecutiveFailures = prev.consecutiveFailures + 1;
    }

    results[ext.platform] = health;
    logger.info('probe', `${ext.platform}: ${health.status}`, {
      error: health.lastError,
    });
  }

  return results;
}

/** Format health report for Telegram notification */
export function formatHealthAlert(
  health: Record<string, ExtractorHealth>,
): string | null {
  const degraded = Object.values(health).filter(h => h.status !== 'ok');
  if (degraded.length === 0) return null;

  const lines = ['🏥 Extractor 健康警報', ''];
  for (const h of degraded) {
    const icon = h.status === 'down' ? '🔴' : '🟡';
    lines.push(`${icon} ${h.platform}：${h.status}（連續 ${h.consecutiveFailures} 次失敗）`);
    if (h.lastError) lines.push(`   └ ${h.lastError.slice(0, 100)}`);
  }

  return lines.join('\n');
}
