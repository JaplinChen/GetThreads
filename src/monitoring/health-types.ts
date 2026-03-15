/** Types for self-healing monitoring system. */

export interface VaultIssue {
  file: string;
  issue: string;
  autoFixable: boolean;
  fixed?: boolean;
}

export interface ExtractorHealth {
  platform: string;
  status: 'ok' | 'degraded' | 'down';
  lastCheckAt: string;
  lastError?: string;
  consecutiveFailures: number;
}

export interface HealthReport {
  timestamp: string;
  vault: {
    totalNotes: number;
    issuesFound: number;
    autoFixed: number;
  };
  extractors: ExtractorHealth[];
  enrichment: {
    llmAvailable: boolean;
    fallbackUsed: boolean;
  };
}

export interface MonitorConfig {
  /** Vault health check interval in hours (default: 12) */
  vaultCheckHours: number;
  /** Extractor probe interval in hours (default: 24) */
  extractorCheckHours: number;
  lastVaultCheckAt: string | null;
  lastExtractorCheckAt: string | null;
  extractorHealth: Record<string, ExtractorHealth>;
}

export const DEFAULT_MONITOR_CONFIG: MonitorConfig = {
  vaultCheckHours: 12,
  extractorCheckHours: 24,
  lastVaultCheckAt: null,
  lastExtractorCheckAt: null,
  extractorHealth: {},
};
