import { Telegraf } from 'telegraf';
import { logger } from './core/logger.js';
import type { AppConfig } from './utils/config.js';
import { registerCommands } from './commands/register-commands.js';
import { registerMessageHandlers } from './messages/url-message-handler.js';
import type { BotStats } from './messages/types.js';

const startTime = Date.now();
const stats: BotStats = { urls: 0, saved: 0, errors: 0, recent: [] };

/** Check if a Telegram user is allowed to use this bot */
function isAuthorized(config: AppConfig, userId: number | undefined): boolean {
  if (!config.allowedUserIds || config.allowedUserIds.size === 0) return true;
  return userId !== undefined && config.allowedUserIds.has(userId);
}

export function createBot(config: AppConfig): Telegraf {
  const bot = new Telegraf(config.botToken, {
    handlerTimeout: 90_000,
  });

  // Auth middleware: all handlers below require authorization.
  bot.use((ctx, next) => {
    if (!isAuthorized(config, ctx.from?.id)) {
      logger.warn('auth', 'Unauthorized access', { userId: ctx.from?.id });
      return;
    }
    return next();
  });

  // Register all /commands and message pipeline.
  registerCommands(bot, config, stats, startTime);
  registerMessageHandlers(bot, config, stats);

  return bot;
}

