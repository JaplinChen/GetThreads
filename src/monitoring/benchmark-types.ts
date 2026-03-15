/** Types for enrichment quality benchmarking. */

export interface EnrichmentScore {
  /** 0-1: summary quality (length, no emotional language) */
  summaryScore: number;
  /** 0-1: keyword relevance (overlap with title/body tokens) */
  keywordScore: number;
  /** 0-1: classification accuracy (matches learned patterns) */
  classificationScore: number;
  /** 0-1: completeness (all fields filled) */
  completenessScore: number;
  /** Overall composite score 0-100 */
  overall: number;
}

export interface PlatformStats {
  platform: string;
  totalAttempts: number;
  successCount: number;
  failureCount: number;
  avgEnrichScore: number;
  successRate: number;
}

export interface BenchmarkReport {
  generatedAt: string;
  period: string;
  /** Overall enrichment stats */
  totalEnriched: number;
  avgOverallScore: number;
  /** Per-platform extraction success rates */
  platformStats: PlatformStats[];
  /** Score distribution (buckets of 10: 0-10, 10-20, ..., 90-100) */
  scoreDistribution: Record<string, number>;
  /** Quality trend: recent vs previous period */
  qualityTrend: 'improving' | 'stable' | 'declining';
}

export interface BenchmarkData {
  /** Individual note scores keyed by URL */
  scores: Record<string, { score: EnrichmentScore; timestamp: string; platform: string }>;
  /** Platform extraction attempts */
  platformAttempts: Record<string, { success: number; failure: number }>;
  lastUpdatedAt: string;
}
