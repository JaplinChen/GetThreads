/** Types for proactive intelligence system. */

export interface ProactiveConfig {
  /** Enable proactive digest push (default: true) */
  enabled: boolean;
  /** Digest push interval in hours (default: 24 = daily) */
  digestIntervalHours: number;
  /** Trend alert check interval in hours (default: 6) */
  trendIntervalHours: number;
  /** Minimum notes to trigger digest (default: 3) */
  minNotesForDigest: number;
  /** Last digest push timestamp */
  lastDigestAt: string | null;
  /** Last trend check timestamp */
  lastTrendAt: string | null;
}

export interface TrendAlert {
  keyword: string;
  recentCount: number;
  previousCount: number;
  growthRate: number;
}

export interface CategoryGap {
  category: string;
  daysSinceLastNote: number;
}

export interface ProactiveDigest {
  period: string;
  totalNotes: number;
  categoryBreakdown: Array<{ category: string; count: number }>;
  trends: TrendAlert[];
  gaps: CategoryGap[];
  summary?: string;
}

export const DEFAULT_PROACTIVE_CONFIG: ProactiveConfig = {
  enabled: true,
  digestIntervalHours: 24,
  trendIntervalHours: 6,
  minNotesForDigest: 3,
  lastDigestAt: null,
  lastTrendAt: null,
};
