/**
 * Classification feedback tracker — records user corrections to strengthen
 * the dynamic classifier through a reinforcement learning loop.
 *
 * When users manually reclassify notes, the correction is recorded and used
 * to boost/penalize classifier rules in future vault-learner runs.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { logger } from '../core/logger.js';

export interface ClassificationFeedback {
  /** Original classified category */
  from: string;
  /** User-corrected category */
  to: string;
  /** Title of the note */
  title: string;
  /** Keywords from the note */
  keywords: string[];
  /** Timestamp of correction */
  timestamp: string;
}

export interface FeedbackStore {
  version: number;
  feedbacks: ClassificationFeedback[];
  /** Aggregated boost/penalize weights per keyword→category */
  weights: Record<string, Record<string, number>>;
}

const STORE_PATH = join('data', 'classification-feedback.json');
const MAX_FEEDBACKS = 200;

let cached: FeedbackStore | null = null;

function defaultStore(): FeedbackStore {
  return { version: 1, feedbacks: [], weights: {} };
}

export async function loadFeedbackStore(): Promise<FeedbackStore> {
  if (cached) return cached;
  try {
    const raw = await readFile(STORE_PATH, 'utf-8');
    cached = { ...defaultStore(), ...JSON.parse(raw) };
    return cached!;
  } catch {
    cached = defaultStore();
    return cached;
  }
}

async function saveFeedbackStore(store: FeedbackStore): Promise<void> {
  cached = store;
  await mkdir(dirname(STORE_PATH), { recursive: true });
  await writeFile(STORE_PATH, JSON.stringify(store, null, 2), 'utf-8');
}

/** Record a user correction and update aggregated weights */
export async function recordFeedback(feedback: ClassificationFeedback): Promise<void> {
  const store = await loadFeedbackStore();

  // Add feedback (trim old entries if over limit)
  store.feedbacks.push(feedback);
  if (store.feedbacks.length > MAX_FEEDBACKS) {
    store.feedbacks = store.feedbacks.slice(-MAX_FEEDBACKS);
  }

  // Update weights: boost keywords toward correct category, penalize wrong one
  const keyTokens = [
    ...feedback.keywords.map(k => k.toLowerCase()),
    ...feedback.title.toLowerCase().split(/\s+/).filter(t => t.length >= 3),
  ];

  for (const token of keyTokens) {
    if (!store.weights[token]) store.weights[token] = {};

    // Boost correct category
    store.weights[token][feedback.to] = (store.weights[token][feedback.to] ?? 0) + 1;

    // Penalize wrong category
    store.weights[token][feedback.from] = (store.weights[token][feedback.from] ?? 0) - 0.5;
  }

  await saveFeedbackStore(store);
  logger.info('feedback', '記錄分類校正', {
    from: feedback.from,
    to: feedback.to,
    title: feedback.title.slice(0, 40),
  });
}

/**
 * Get feedback-adjusted score for a keyword→category pair.
 * Returns a bonus (positive = boost, negative = penalize) to apply to base score.
 */
export function getFeedbackWeight(keyword: string, category: string): number {
  if (!cached) return 0;
  const kwWeights = cached.weights[keyword.toLowerCase()];
  if (!kwWeights) return 0;
  return kwWeights[category] ?? 0;
}

/** Get aggregated feedback stats for reporting */
export function getFeedbackStats(): {
  totalCorrections: number;
  topMistakes: Array<{ from: string; to: string; count: number }>;
} {
  if (!cached) return { totalCorrections: 0, topMistakes: [] };

  const mistakeMap = new Map<string, number>();
  for (const fb of cached.feedbacks) {
    const key = `${fb.from} → ${fb.to}`;
    mistakeMap.set(key, (mistakeMap.get(key) ?? 0) + 1);
  }

  const topMistakes = [...mistakeMap.entries()]
    .map(([key, count]) => {
      const [from, to] = key.split(' → ');
      return { from, to, count };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return { totalCorrections: cached.feedbacks.length, topMistakes };
}
