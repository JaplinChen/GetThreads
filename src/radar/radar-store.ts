/**
 * Persistent storage for radar configuration.
 * Pattern: mirrors subscription-store.ts
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { logger } from '../core/logger.js';
import { scanVaultNotes } from '../learning/vault-learner.js';
import { computeFormattingPatterns } from '../learning/vault-learner.js';
import type { RadarConfig, RadarQuery } from './radar-types.js';
import { createEmptyConfig } from './radar-types.js';

const STORE_PATH = join(process.cwd(), 'data', 'radar-config.json');

/** Too-generic keywords that produce noisy results */
const SKIP_KEYWORDS = new Set([
  'ai', '工具', '教學', '分享', '推薦', '介紹', '使用', '功能', '方法', '技巧',
  'archive', 'source', 'image', 'http', 'https', 'com',
]);

export async function loadRadarConfig(): Promise<RadarConfig> {
  try {
    const raw = await readFile(STORE_PATH, 'utf-8');
    return JSON.parse(raw) as RadarConfig;
  } catch {
    return createEmptyConfig();
  }
}

export async function saveRadarConfig(config: RadarConfig): Promise<void> {
  await mkdir(dirname(STORE_PATH), { recursive: true });
  await writeFile(STORE_PATH, JSON.stringify(config, null, 2), 'utf-8');
  logger.info('radar', '已儲存設定', { queries: config.queries.length });
}

export function addQuery(config: RadarConfig, keywords: string[], source: 'auto' | 'manual' = 'manual'): RadarQuery {
  const query: RadarQuery = {
    id: randomUUID().slice(0, 8),
    keywords,
    source,
    addedAt: new Date().toISOString(),
  };
  config.queries.push(query);
  return query;
}

export function removeQuery(config: RadarConfig, id: string): boolean {
  const idx = config.queries.findIndex(q => q.id === id);
  if (idx < 0) return false;
  config.queries.splice(idx, 1);
  return true;
}

/** Auto-generate search queries from vault keyword patterns */
export async function autoGenerateQueries(
  vaultPath: string, config: RadarConfig,
): Promise<RadarQuery[]> {
  const notes = await scanVaultNotes(vaultPath);
  const patterns = computeFormattingPatterns(notes);
  const added: RadarQuery[] = [];

  // Remove old auto-generated queries
  config.queries = config.queries.filter(q => q.source !== 'auto');

  for (const [category, keywords] of Object.entries(patterns.topKeywordsByCategory)) {
    // Take top 2-3 meaningful keywords per category
    const meaningful = keywords
      .filter(kw => !SKIP_KEYWORDS.has(kw.toLowerCase()) && kw.length >= 2)
      .slice(0, 3);

    if (meaningful.length < 2) continue;

    const query = addQuery(config, meaningful, 'auto');
    added.push(query);

    // Limit total auto queries
    if (added.length >= 8) break;
  }

  logger.info('radar', '自動生成查詢', { count: added.length });
  return added;
}
