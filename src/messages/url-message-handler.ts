import type { Telegraf } from 'telegraf';
import type { AppConfig } from '../utils/config.js';
import { registerForceReplyRouter } from './force-reply-router.js';
import { registerUrlProcessingHandler } from './url-processing-handler.js';
import type { BotStats } from './types.js';

export type { BotStats };

export function registerMessageHandlers(bot: Telegraf, config: AppConfig, stats: BotStats): void {
  registerForceReplyRouter(bot);
  registerUrlProcessingHandler(bot, config, stats);
}
