import 'dotenv/config';
import { existsSync } from 'node:fs';

export interface AppConfig {
  botToken: string;
  vaultPath: string;
  /** Optional: enables AI-powered keyword and summary enrichment */
  anthropicApiKey?: string;
  /** Optional: Telegram user ID whitelist. Undefined = allow all. */
  allowedUserIds?: Set<number>;
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
    throw new Error('VAULT_PATH 不存在，請確認路徑是否正確');
  }

  const allowedRaw = process.env.ALLOWED_USER_IDS;
  const allowedUserIds = allowedRaw
    ? new Set(
        allowedRaw
          .split(',')
          .map(s => parseInt(s.trim(), 10))
          .filter(n => !isNaN(n)),
      )
    : undefined;

  return {
    botToken,
    vaultPath,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    allowedUserIds,
  };
}
