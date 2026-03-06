import { loadConfig } from './utils/config.js';
import { registerAllExtractors } from './extractors/index.js';
import { createBot } from './bot.js';
import { ProcessGuardian } from './process-guardian.js';
import { initDynamicClassifier, refreshFromPatterns } from './learning/dynamic-classifier.js';
import { runVaultLearner } from './learning/vault-learner.js';
import { RULES_PATH } from './learning/learn-command.js';

const config = loadConfig();
registerAllExtractors();

const bot = createBot(config);

bot.catch((err: unknown) => {
  console.error('[Bot error]', err);
});

// Load existing rules immediately (fast, from disk)
initDynamicClassifier(RULES_PATH).catch(() => {});

// Re-scan vault in background to update rules (slow, but non-blocking)
runVaultLearner(config.vaultPath, RULES_PATH)
  .then((patterns) => refreshFromPatterns(patterns))
  .catch((e) => console.warn('[learn] 啟動學習失敗:', (e as Error).message));

new ProcessGuardian(bot).launch();
