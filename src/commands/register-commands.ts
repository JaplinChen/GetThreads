/**
 * Centralized command registration.
 * Keeps lightweight orchestration while command groups live in dedicated modules.
 */
import type { Context, Telegraf } from 'telegraf';
import type { AppConfig } from '../utils/config.js';
import { handleTimeline } from './timeline-command.js';
import { handleMonitor, handleSearch } from './monitor-command.js';
import { handleAnalyze, handleKnowledge, handleGaps, handleSkills } from './knowledge-command.js';
import {
  handleRecommend,
  handleBrief,
  handleCompare,
  handleRecommendByTopic,
  handleBriefByTopic,
  handleCompareByArg,
  resolveCallbackToken,
} from './knowledge-query-command.js';
import { runCommandTask } from './command-runner.js';
import { formatErrorMessage } from '../core/errors.js';
import { logger } from '../core/logger.js';
import { BOT_COMMANDS_MENU, HELP_TEXT } from './command-help.js';
import { registerLearningCommands } from './register-learning-commands.js';
import { registerInfoCommands, type CommandStats } from './register-info-commands.js';

export { formatErrorMessage };

type MatchedContext = Context & { match: RegExpExecArray };

function registerAsyncCommand(
  bot: Telegraf,
  command: string | readonly string[],
  tag: string,
  config: AppConfig,
  handler: (ctx: Context, config: AppConfig) => Promise<void>,
): void {
  bot.command(command as string | string[], (ctx) => {
    runCommandTask(ctx, tag, () => handler(ctx, config), formatErrorMessage).catch(() => {});
  });
}

function registerAsyncAction(
  bot: Telegraf,
  pattern: RegExp,
  tag: string,
  handler: (ctx: MatchedContext) => Promise<void>,
): void {
  bot.action(pattern, (ctx) => {
    const matchedCtx = ctx as MatchedContext;
    runCommandTask(matchedCtx, tag, () => handler(matchedCtx), formatErrorMessage).catch(() => {});
  });
}

export function registerCommands(
  bot: Telegraf,
  config: AppConfig,
  stats: CommandStats,
  startTime: number,
): void {
  bot.start((ctx) => ctx.reply(HELP_TEXT));
  bot.command('help', (ctx) => ctx.reply(HELP_TEXT));

  registerLearningCommands(bot, config, formatErrorMessage);

  // --- Camoufox-based commands ---
  registerAsyncCommand(bot, 'timeline', 'timeline', config, handleTimeline);
  registerAsyncCommand(bot, 'monitor', 'monitor', config, handleMonitor);
  registerAsyncCommand(bot, ['search', 'google'], 'search', config, handleSearch);

  // --- Knowledge system ---
  registerAsyncCommand(bot, 'analyze', 'analyze', config, handleAnalyze);
  registerAsyncCommand(bot, 'knowledge', 'knowledge', config, handleKnowledge);
  registerAsyncCommand(bot, 'recommend', 'recommend', config, handleRecommend);
  registerAsyncCommand(bot, 'brief', 'brief', config, handleBrief);
  registerAsyncCommand(bot, 'compare', 'compare', config, handleCompare);
  registerAsyncCommand(bot, 'gaps', 'gaps', config, handleGaps);
  registerAsyncCommand(bot, 'skills', 'skills', config, handleSkills);

  // --- InlineKeyboard callback handlers ---
  registerAsyncAction(bot, /^(recommend|brief):(.+)$/, 'knowledge-action', async (ctx) => {
    const [, cmd, rawTopic] = ctx.match!;
    const topic = resolveCallbackToken(cmd, rawTopic);
    await ctx.answerCbQuery().catch(() => {});
    if (!topic) {
      await ctx.reply('This button has expired. Please run /recommend or /brief again.');
      return;
    }
    const handler = cmd === 'recommend' ? handleRecommendByTopic : handleBriefByTopic;
    await handler(ctx, topic);
  });

  registerAsyncAction(bot, /^compare:(.+)$/, 'compare-action', async (ctx) => {
    const rawArg = ctx.match![1];
    const arg = resolveCallbackToken('compare', rawArg);
    await ctx.answerCbQuery().catch(() => {});
    if (!arg) {
      await ctx.reply('This button has expired. Please run /compare again.');
      return;
    }
    await handleCompareByArg(ctx, arg);
  });

  registerInfoCommands(bot, stats, startTime);

  // --- Register command menu ---
  bot.telegram
    .setMyCommands(BOT_COMMANDS_MENU)
    .catch((err) => logger.warn('bot', 'setMyCommands failed', err));
}

