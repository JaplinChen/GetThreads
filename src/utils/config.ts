import { existsSync } from 'node:fs';
import { config as dotenvConfig } from 'dotenv';

dotenvConfig({ override: true });

export interface AppConfig {
  botToken: string;
  vaultPath: string;
  /** Optional: enables AI-powered keyword and summary enrichment */
  anthropicApiKey?: string;
  /** Optional: Telegram user ID whitelist. Undefined = allow all. */
  allowedUserIds?: Set<number>;
  /** Enable automatic translation of non-zh-TW content (requires anthropicApiKey) */
  enableTranslation: boolean;
  /** Max URLs to enrich from post/comments (default: 5) */
  maxLinkedUrls: number;
}

export function loadConfig(): AppConfig {
  const botToken = process.env.BOT_TOKEN;
  const vaultPath = process.env.VAULT_PATH;

  if (!botToken) {
    throw new Error('BOT_TOKEN is required in .env');
  }
  if (!vaultPath) {
    throw new Error('VAULT_PATH is required in .env');
  }

  if (!existsSync(vaultPath)) {
    throw new Error('VAULT_PATH points to a directory that does not exist');
  }

  const allowedRaw = process.env.ALLOWED_USER_IDS;
  const allowedUserIds = allowedRaw
    ? new Set(
        allowedRaw
          .split(',')
          .map((s) => parseInt(s.trim(), 10))
          .filter((n) => !isNaN(n)),
      )
    : undefined;

  return {
    botToken,
    vaultPath,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    allowedUserIds,
    enableTranslation: process.env.ENABLE_TRANSLATION === 'true',
    maxLinkedUrls: parseInt(process.env.MAX_LINKED_URLS ?? '5', 10) || 5,
  };
}
