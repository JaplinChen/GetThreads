/** Content radar — type definitions */

export interface RadarConfig {
  version: number;
  enabled: boolean;
  intervalHours: number;
  maxResultsPerQuery: number;
  maxTotalPerCycle: number;
  queries: RadarQuery[];
  lastRunAt?: string;
}

export interface RadarQuery {
  id: string;
  keywords: string[];
  source: 'auto' | 'manual';
  addedAt: string;
  lastHitCount?: number;
}

export interface RadarResult {
  query: RadarQuery;
  saved: number;
  skipped: number;
  errors: number;
}

export function createEmptyConfig(): RadarConfig {
  return {
    version: 1,
    enabled: false,
    intervalHours: 6,
    maxResultsPerQuery: 3,
    maxTotalPerCycle: 10,
    queries: [],
  };
}
